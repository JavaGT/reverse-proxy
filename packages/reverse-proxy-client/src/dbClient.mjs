import {
    mergeServerSettingsSparseWithDefaults,
    mergedServerSettingsToEnvRecord,
    overlayEnvBootstrapForOmittedSqliteKeys
} from "../../../src/config/serverSettingsRegistry.mjs";
import { SqlitePersistence } from "../../../src/infrastructure/persistence/SqlitePersistence.mjs";
import { hydrateRegistryFromPersistence } from "../../../src/management/bootstrapFromPersistence.mjs";
import { normalizeReserveOptions, ReserveValidationError } from "../../../src/shared/utils/ReserveOptions.mjs";
import { isValidApexFQDN } from "../../../src/shared/utils/isValidApexFqdn.mjs";
import {
    assertValidDnsConsoleConfig,
    normalizeDnsConsoleInput,
    resolveDnsConsoleLinks
} from "../../../src/infrastructure/dns/console/resolveConsoleLinks.mjs";
import { listDnsConsoleProviderIds } from "../../../src/infrastructure/dns/console/DnsConsoleRegistry.mjs";
import { buildDdnsPublicSummary, mergePutDdnsBody } from "../../../src/ddns/ddnsConfigResolve.mjs";
import { SqliteIpCache } from "../../../src/ddns/infrastructure/adapters/SqliteIpCache.mjs";
import { LEGACY_V1_JOB_ID } from "../../../src/ddns/ddnsDocument.mjs";
import { ManagementApiError } from "./errors.mjs";

/** @param {Record<string, unknown>} body */
function parseReservationTargets(body) {
    let reservationTargets = body.targets;
    if (!reservationTargets) {
        if (body.ports) reservationTargets = body.ports;
        else if (body.port !== undefined && body.port !== null) reservationTargets = [body.port];
    }
    return reservationTargets;
}

/**
 * @param {{ getDatabaseSync?: () => import("node:sqlite").DatabaseSync, getDdnsLastRun?: () => unknown }} persistence
 * @param {{ jobs?: Array<{ id?: string }> }} summary
 */
async function attachDdnsIpCacheAndLastRun(persistence, summary) {
    let cachedPublicIp = null;
    /** @type {Record<string, unknown>} */
    const cachedPublicIpByJob = {};
    if (typeof persistence.getDatabaseSync === "function") {
        try {
            const db = persistence.getDatabaseSync();
            const jobList = Array.isArray(summary.jobs) ? summary.jobs : [];
            for (const j of jobList) {
                if (!j?.id) continue;
                const cache = new SqliteIpCache(db, j.id);
                const ip = await cache.read();
                cachedPublicIpByJob[j.id] = ip ? ip.toJSON() : null;
            }
            cachedPublicIp =
                cachedPublicIpByJob[LEGACY_V1_JOB_ID] ??
                (jobList[0]?.id ? cachedPublicIpByJob[jobList[0].id] : null) ??
                null;
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            console.error(`[@javagt/reverse-proxy-client] DDNS cached IP read failed (non-fatal): ${detail}`);
        }
    }
    const lastRun =
        typeof persistence.getDdnsLastRun === "function" ? persistence.getDdnsLastRun() : null;
    return { cachedPublicIp, cachedPublicIpByJob, lastRun };
}

/**
 * Direct SQLite management (use only while the proxy process is stopped; otherwise the DB may be locked or corrupted).
 *
 * @param {{
 *   dbPath: string,
 *   env?: NodeJS.ProcessEnv,
 *   publicUrlHttpsPrefix?: string,
 *   publicUrlHttpPrefix?: string,
 *   defaultRootDomains?: string
 * }} options
 */
export function createDbClient(options) {
    const persistence = new SqlitePersistence(options.dbPath);
    const getEffectiveEnv = () => {
        if (options.env) return options.env;
        const sparse = persistence.getServerSettings();
        const merged = mergeServerSettingsSparseWithDefaults(sparse);
        overlayEnvBootstrapForOmittedSqliteKeys(sparse, merged);
        return mergedServerSettingsToEnvRecord(merged);
    };
    const publicUrlHttpsPrefix = options.publicUrlHttpsPrefix ?? "https";
    const publicUrlHttpPrefix = options.publicUrlHttpPrefix ?? "http";
    const defaultRootDomains = options.defaultRootDomains ?? "javagrant.ac.nz";

    /** @type {import("../../../src/domain/RouteRegistry.mjs").RouteRegistry | null} */
    let registry = null;

    async function ensure() {
        if (!registry) {
            const { registry: r } = await hydrateRegistryFromPersistence(persistence, getEffectiveEnv(), {
                defaultRootDomains,
                logger: {}
            });
            registry = r;
        }
    }

    /** @param {object | null | undefined} stored */
    function ddnsPublicSummary(stored) {
        return buildDdnsPublicSummary({
            getApexDomains: () => registry.getRootDomains(),
            stored: stored ?? null,
            getDnsConsoleContext: () => ({
                dnsConsole: persistence.getRootDomainConfig?.()?.dnsConsole ?? null,
                env: getEffectiveEnv()
            })
        });
    }

    /** @param {string} host */
    function publicFieldsForHost(host) {
        const baseDomain = registry.baseDomainForHost(host);
        return {
            baseDomain,
            rootDomain: baseDomain,
            publicUrl: `${publicUrlHttpsPrefix}://${host}`,
            publicUrlHttp: `${publicUrlHttpPrefix}://${host}`
        };
    }

    function performReservation(subdomain, baseDomain, normalizedOptions, reservationTargets) {
        if (typeof reservationTargets[0] === "number") {
            return registry.reserveWithOutcome(subdomain, reservationTargets, normalizedOptions, baseDomain);
        }
        return registry.reserveUrlTargetsWithOutcome(subdomain, reservationTargets, normalizedOptions, baseDomain);
    }

    function rollbackReserveBatch(createdStack) {
        for (const { subdomain, baseDomain } of createdStack.slice().reverse()) {
            try {
                registry.release(subdomain, baseDomain);
            } catch {
                /* ignore */
            }
        }
    }

    /** @param {Record<string, unknown>} reqBody */
    async function reserveBatch(reqBody) {
        const items = reqBody?.reservations;
        if (!Array.isArray(items) || items.length === 0) {
            throw new ManagementApiError(400, "INVALID_REQUEST", "reservations must be a non-empty array", null, null);
        }

        const createdStack = [];
        const results = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i] ?? {};

            let normalizedOptions;
            try {
                normalizedOptions = normalizeReserveOptions(item.options);
            } catch (e) {
                rollbackReserveBatch(createdStack);
                if (e instanceof ReserveValidationError) {
                    throw new ManagementApiError(400, e.code, `reservations[${i}]: ${e.message}`, null, null);
                }
                throw e;
            }

            const baseDomainRaw = item.baseDomain;
            if (baseDomainRaw == null || String(baseDomainRaw).trim() === "") {
                rollbackReserveBatch(createdStack);
                throw new ManagementApiError(400, "INVALID_REQUEST", `reservations[${i}]: baseDomain is required`, null, null);
            }
            const baseDomain = String(baseDomainRaw).trim().toLowerCase();

            if (item.subdomain == null || String(item.subdomain).trim() === "") {
                rollbackReserveBatch(createdStack);
                throw new ManagementApiError(400, "INVALID_REQUEST", `reservations[${i}]: subdomain is required`, null, null);
            }

            const reservationTargets = parseReservationTargets(item);
            if (!reservationTargets || (Array.isArray(reservationTargets) && reservationTargets.length === 0)) {
                rollbackReserveBatch(createdStack);
                throw new ManagementApiError(
                    400,
                    "INVALID_REQUEST",
                    `reservations[${i}]: targets, ports, or port is required`,
                    null,
                    null
                );
            }

            let outcome;
            try {
                outcome = performReservation(item.subdomain, baseDomain, normalizedOptions, reservationTargets);
            } catch (err) {
                rollbackReserveBatch(createdStack);
                if (err instanceof Error && err.message.includes("is not configured") && err.message.includes("allowed:")) {
                    throw new ManagementApiError(400, "INVALID_REQUEST", `reservations[${i}]: ${err.message}`, null, null);
                }
                throw new ManagementApiError(400, "RESERVATION_FAILED", `reservations[${i}]: ${err.message}`, null, null);
            }

            if (outcome.outcome === "conflict") {
                rollbackReserveBatch(createdStack);
                const message =
                    outcome.reason === "reserved_host"
                        ? `${outcome.host} is reserved for the management interface`
                        : `${outcome.host} is already in use by another mapping; override is not allowed while the service is healthy`;
                throw new ManagementApiError(409, "SUBDOMAIN_CONFLICT", message, {
                    host: outcome.host,
                    reason: outcome.reason,
                    index: i
                });
            }

            const payload = { ...outcome.data, ...publicFieldsForHost(outcome.data.host) };
            results.push({ outcome: outcome.outcome, data: payload });

            if (outcome.outcome === "created") {
                createdStack.push({ subdomain: item.subdomain, baseDomain });
            }
        }

        try {
            await persistence.save(registry.getPersistentRoutes());
        } catch (persistErr) {
            rollbackReserveBatch(createdStack);
            throw new ManagementApiError(500, "PERSISTENCE_FAILED", persistErr.message, null, null);
        }

        const anyCreated = results.some(r => r.outcome === "created");
        return { data: { batch: true, results }, status: anyCreated ? 201 : 200 };
    }

    return {
        persistence,

        async health() {
            await ensure();
            return { data: { status: "OK", source: "database" } };
        },

        async getDomains() {
            await ensure();
            const apexDomains = registry.getRootDomains();
            const cfg = persistence.getRootDomainConfig?.() ?? null;
            const dnsConsole = cfg?.dnsConsole ?? null;
            const dnsConsoleLinks = resolveDnsConsoleLinks(apexDomains, dnsConsole ?? undefined);
            return {
                data: {
                    primary: registry.rootDomain,
                    apexDomains,
                    dnsConsole,
                    dnsConsoleLinks,
                    dnsConsoleProviderIds: listDnsConsoleProviderIds()
                }
            };
        },

        async getRoutes() {
            await ensure();
            const routes = registry.getAllRoutes().map(r => ({
                ...r,
                ...publicFieldsForHost(r.host)
            }));
            return { data: routes };
        },

        /** @param {Record<string, unknown>} body */
        async reserve(body) {
            await ensure();
            try {
                if (Array.isArray(body?.reservations)) {
                    return await reserveBatch(body);
                }

                let normalizedOptions;
                try {
                    normalizedOptions = normalizeReserveOptions(body?.options);
                } catch (e) {
                    if (e instanceof ReserveValidationError) {
                        throw new ManagementApiError(400, e.code, e.message, null, null);
                    }
                    throw e;
                }

                const baseDomainRaw = body.baseDomain;
                if (baseDomainRaw == null || String(baseDomainRaw).trim() === "") {
                    throw new ManagementApiError(400, "INVALID_REQUEST", "baseDomain is required", null, null);
                }
                if (body.subdomain == null || String(body.subdomain).trim() === "") {
                    throw new ManagementApiError(400, "INVALID_REQUEST", "subdomain is required", null, null);
                }

                const reservationTargets = parseReservationTargets(body);
                if (!reservationTargets || (Array.isArray(reservationTargets) && reservationTargets.length === 0)) {
                    throw new ManagementApiError(400, "INVALID_REQUEST", "targets, ports, or port is required", null, null);
                }

                const outcome = performReservation(
                    body.subdomain,
                    String(baseDomainRaw).trim().toLowerCase(),
                    normalizedOptions,
                    reservationTargets
                );

                if (outcome.outcome === "conflict") {
                    const message =
                        outcome.reason === "reserved_host"
                            ? `${outcome.host} is reserved for the management interface`
                            : `${outcome.host} is already in use by another mapping; override is not allowed while the service is healthy`;
                    throw new ManagementApiError(409, "SUBDOMAIN_CONFLICT", message, {
                        host: outcome.host,
                        reason: outcome.reason
                    });
                }

                const payload = { ...outcome.data, ...publicFieldsForHost(outcome.data.host) };

                if (outcome.outcome === "unchanged") {
                    return { data: payload };
                }

                try {
                    await persistence.save(registry.getPersistentRoutes());
                } catch (persistErr) {
                    throw new ManagementApiError(500, "PERSISTENCE_FAILED", persistErr.message, null, null);
                }

                return { data: payload };
            } catch (e) {
                if (e instanceof ManagementApiError) throw e;
                if (e instanceof ReserveValidationError) {
                    throw new ManagementApiError(400, e.code, e.message, null, null);
                }
                if (e instanceof Error && e.message.includes("is not configured") && e.message.includes("allowed:")) {
                    throw new ManagementApiError(400, "INVALID_REQUEST", e.message, null, null);
                }
                throw new ManagementApiError(400, "RESERVATION_FAILED", e instanceof Error ? e.message : String(e), null, null);
            }
        },

        /** @param {string} subdomain @param {string} baseDomain */
        async release(subdomain, baseDomain) {
            await ensure();
            try {
                if (baseDomain == null || String(baseDomain).trim() === "") {
                    throw new ManagementApiError(400, "INVALID_REQUEST", "baseDomain is required", null, null);
                }
                const result = registry.release(subdomain, baseDomain);
                if (!result) {
                    throw new ManagementApiError(404, "ROUTE_NOT_FOUND", "Route not found", null, null);
                }
                try {
                    await persistence.save(registry.getPersistentRoutes());
                } catch (persistErr) {
                    throw new ManagementApiError(500, "PERSISTENCE_FAILED", persistErr.message, null, null);
                }
                return { data: { ...result, ...publicFieldsForHost(result.host) } };
            } catch (e) {
                if (e instanceof ManagementApiError) throw e;
                if (e instanceof Error && e.message.includes("baseDomain is required")) {
                    throw new ManagementApiError(400, "INVALID_REQUEST", e.message, null, null);
                }
                throw new ManagementApiError(400, "RELEASE_FAILED", e instanceof Error ? e.message : String(e), null, null);
            }
        },

        /** @param {Record<string, unknown>} body */
        async putDomains(body) {
            await ensure();
            const apexDomains = body?.apexDomains;
            if (!Array.isArray(apexDomains)) {
                throw new ManagementApiError(400, "INVALID_REQUEST", "apexDomains must be an array", null, null);
            }

            const normalized = [];
            const seen = new Set();
            for (const d of apexDomains) {
                const x = String(d ?? "")
                    .trim()
                    .toLowerCase();
                if (!x || seen.has(x)) continue;
                if (!isValidApexFQDN(x)) {
                    throw new ManagementApiError(400, "INVALID_REQUEST", `Invalid apex domain: ${d}`, null, null);
                }
                seen.add(x);
                normalized.push(x);
            }

            if (normalized.length === 0) {
                throw new ManagementApiError(400, "INVALID_REQUEST", "At least one unique apex domain is required", null, null);
            }

            try {
                registry.setRootDomains(normalized);
            } catch (err) {
                throw new ManagementApiError(400, "DOMAIN_CONFLICT", err instanceof Error ? err.message : String(err), null, null);
            }

            let nextDnsConsole;
            if (Object.prototype.hasOwnProperty.call(body ?? {}, "dnsConsole")) {
                const raw = body.dnsConsole;
                if (raw === null) {
                    nextDnsConsole = null;
                } else {
                    const norm = normalizeDnsConsoleInput(raw);
                    if (norm === null && raw != null && typeof raw === "object") {
                        throw new ManagementApiError(400, "INVALID_REQUEST", "Invalid dnsConsole shape", null, null);
                    }
                    if (norm) {
                        try {
                            assertValidDnsConsoleConfig(norm);
                        } catch (e) {
                            throw new ManagementApiError(
                                400,
                                "INVALID_REQUEST",
                                e instanceof Error ? e.message : String(e),
                                null,
                                null
                            );
                        }
                    }
                    nextDnsConsole = norm;
                }
            } else {
                nextDnsConsole = persistence.getRootDomainConfig?.()?.dnsConsole;
            }

            try {
                await persistence.saveRootDomainConfig({
                    apexDomains: normalized,
                    dnsConsole: nextDnsConsole
                });
                await persistence.save(registry.getPersistentRoutes());
            } catch (persistErr) {
                throw new ManagementApiError(500, "PERSISTENCE_FAILED", persistErr.message, null, null);
            }

            const apexAfter = registry.getRootDomains();
            const persisted = persistence.getRootDomainConfig?.() ?? null;
            return {
                data: {
                    primary: registry.rootDomain,
                    apexDomains: apexAfter,
                    dnsConsole: persisted?.dnsConsole ?? null,
                    dnsConsoleLinks: resolveDnsConsoleLinks(apexAfter, persisted?.dnsConsole ?? undefined),
                    dnsConsoleProviderIds: listDnsConsoleProviderIds()
                }
            };
        },

        async getDdns() {
            if (typeof persistence.getDdnsSettings !== "function") {
                throw new ManagementApiError(501, "NOT_IMPLEMENTED", "DDNS settings require SQLite persistence", null, null);
            }
            await ensure();
            const summary = ddnsPublicSummary(persistence.getDdnsSettings());
            const extras = await attachDdnsIpCacheAndLastRun(persistence, summary);
            return { data: { ...summary, ...extras } };
        },

        /** @param {Record<string, unknown>} body */
        async putDdns(body) {
            if (
                typeof persistence.getDdnsSettings !== "function" ||
                typeof persistence.saveDdnsSettings !== "function"
            ) {
                throw new ManagementApiError(501, "NOT_IMPLEMENTED", "DDNS settings require SQLite persistence", null, null);
            }
            await ensure();
            const prev = persistence.getDdnsSettings();
            const merged = mergePutDdnsBody(prev, body, isValidApexFQDN);
            if (!merged.ok) {
                throw new ManagementApiError(400, "INVALID_REQUEST", merged.message, null, null);
            }
            persistence.saveDdnsSettings(merged.value);
            const summary = ddnsPublicSummary(persistence.getDdnsSettings());
            const extras = await attachDdnsIpCacheAndLastRun(persistence, summary);
            return { data: { ...summary, ...extras } };
        },

        async deleteDdns() {
            if (typeof persistence.clearDdnsSettings !== "function") {
                throw new ManagementApiError(501, "NOT_IMPLEMENTED", "DDNS settings require SQLite persistence", null, null);
            }
            await ensure();
            persistence.clearDdnsSettings();
            const summary = ddnsPublicSummary(null);
            const extras = await attachDdnsIpCacheAndLastRun(persistence, summary);
            return { data: { ...summary, ...extras } };
        }
    };
}
