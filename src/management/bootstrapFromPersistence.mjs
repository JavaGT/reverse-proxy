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
    const fromEnv = parseCommaDomains(env.ROOT_DOMAINS || defaultRoots);
    const fromDb = rootDomainConfig?.apexDomains?.length ? rootDomainConfig.apexDomains : null;
    const effectiveRoots = fromDb ?? fromEnv;

    const log = options.logger ?? {};

    if (fromDb?.length) {
        log.info?.({ apexDomains: fromDb }, "Apex domains loaded from SQLite (override default root domains)");
    }

    const registry = new RouteRegistry(effectiveRoots[0], {
        additionalRootDomains: effectiveRoots.slice(1),
        reservedHosts: []
    });

    registry.hydrate(initialRoutes);

    const manualOverrides = rawManual && typeof rawManual === "object" && !Array.isArray(rawManual) ? rawManual : {};
    const apexSet = new Set(effectiveRoots);

    for (const [apex, subMap] of Object.entries(manualOverrides)) {
        if (!apexSet.has(apex)) {
            log.warn?.({ apex }, "Skipping manual overrides for apex not in configured roots");
            continue;
        }
        if (!subMap || typeof subMap !== "object" || Array.isArray(subMap)) {
            log.warn?.({ apex }, "Skipping manual overrides: expected object map of subdomain to port(s)");
            continue;
        }
        for (const [subdomain, ports] of Object.entries(subMap)) {
            if (typeof ports !== "number" && !Array.isArray(ports)) {
                log.warn?.({ apex, subdomain }, "Skipping manual override entry: port must be a number or number[]");
                continue;
            }
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
