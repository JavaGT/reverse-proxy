import { RouteRegistry } from "../domain/RouteRegistry.mjs";

/**
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function parseCommaDomains(raw) {
    return String(raw ?? "")
        .split(",")
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Legacy manualOverrides were `{ subdomain: port }` for a single apex.
 * New shape is `{ [apex]: { [subdomain]: port | port[] } }`.
 * @param {unknown} raw
 * @param {string} primaryApex
 */
function expandManualOverrides(raw, primaryApex) {
    if (!raw || typeof raw !== "object") return {};
    const values = Object.values(raw);
    if (values.length === 0) return {};
    const first = values[0];
    if (typeof first === "number" || Array.isArray(first)) {
        return { [primaryApex]: raw };
    }
    return raw;
}

/**
 * @typedef {{ info?: (o: object, m: string) => void, warn?: (o: object, m: string) => void, error?: (o: object, m: string) => void }} BootstrapLogger
 */

/**
 * Loads SQLite state into a new RouteRegistry (same rules as server startup).
 *
 * @param {import("../infrastructure/persistence/SqlitePersistence.mjs").SqlitePersistence} persistence
 * @param {NodeJS.ProcessEnv} env
 * @param {{ defaultRootDomains?: string, logger?: BootstrapLogger }} [options]
 * @returns {Promise<{ registry: import("../domain/RouteRegistry.mjs").RouteRegistry, effectiveRoots: string[], fromDb: boolean }>}
 */
export async function hydrateRegistryFromPersistence(persistence, env, options = {}) {
    const { routes: initialRoutes, manualOverrides: rawManual, rootDomainConfig } = await persistence.load();

    const defaultRoots = options.defaultRootDomains ?? "javagrant.ac.nz";
    const fromEnv = parseCommaDomains(env.ROOT_DOMAINS || env.ROOT_DOMAIN || defaultRoots);
    const fromDb = rootDomainConfig?.apexDomains?.length ? rootDomainConfig.apexDomains : null;
    const effectiveRoots = fromDb ?? fromEnv;

    const log = options.logger ?? {};

    if (fromDb?.length) {
        log.info?.({ apexDomains: fromDb }, "Apex domains loaded from SQLite (override ROOT_DOMAINS env)");
    }

    const registry = new RouteRegistry(effectiveRoots[0], {
        additionalRootDomains: effectiveRoots.slice(1),
        reservedHosts: []
    });

    registry.hydrate(initialRoutes);

    const manualOverrides = expandManualOverrides(rawManual, effectiveRoots[0]);
    const apexSet = new Set(effectiveRoots);

    for (const [apex, subMap] of Object.entries(manualOverrides)) {
        if (!apexSet.has(apex)) {
            log.warn?.({ apex }, "Skipping manual overrides for apex not in configured roots");
            continue;
        }
        if (!subMap || typeof subMap !== "object") continue;
        for (const [subdomain, ports] of Object.entries(subMap)) {
            try {
                const host = `${subdomain}.${apex}`;
                const targetArray = Array.isArray(ports) ? ports : [ports];
                const targets = targetArray.map(port => ({
                    url: `http://localhost:${port}`,
                    healthy: true
                }));
                registry.registerPersistentRoute(host, targets, { manual: true });
                log.info?.({ host, targets: targetArray }, "Registered manual override route");
            } catch (err) {
                log.error?.({ subdomain, apex, error: err.message }, "Failed to register manual override");
            }
        }
    }

    return { registry, effectiveRoots, fromDb: Boolean(fromDb?.length) };
}
