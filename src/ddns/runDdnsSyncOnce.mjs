import { PorkbunDnsProvider } from "./infrastructure/adapters/PorkbunDnsProvider.mjs";
import { HttpIpLookup } from "./infrastructure/adapters/HttpIpLookup.mjs";
import { SqliteIpCache } from "./infrastructure/adapters/SqliteIpCache.mjs";
import { SyncService } from "./domain/services/SyncService.mjs";
import { DdnsSyncUseCase } from "./application/DdnsSyncUseCase.mjs";
import { getRuntimeDdnsTick } from "./ddnsConfigResolve.mjs";

const DETAIL_MAX = 512;

/**
 * @param {{ outcome: string, detail: string, skippedBecause?: string | null }} execResult
 * @returns {{ at: string, outcome: string, detail: string, skippedBecause: string | null }}
 */
export function ddnsLastRunRecordFromExecResult(execResult) {
    const detail = String(execResult.detail ?? "").slice(0, DETAIL_MAX);
    return {
        at: new Date().toISOString(),
        outcome: execResult.outcome,
        detail,
        skippedBecause: execResult.skippedBecause ?? null
    };
}

/**
 * @param {Error} err
 * @returns {{ at: string, outcome: 'failed', detail: string, skippedBecause: null }}
 */
export function ddnsLastRunRecordFromError(err) {
    return {
        at: new Date().toISOString(),
        outcome: "failed",
        detail: String(err?.message ?? "DDNS sync failed").slice(0, DETAIL_MAX),
        skippedBecause: null
    };
}

/**
 * Runs one DDNS sync cycle (same wiring as the scheduler) and persists last-run telemetry when `saveDdnsLastRun` exists.
 *
 * @param {{ persistence: { getDatabaseSync: () => import("node:sqlite").DatabaseSync, getDdnsSettings?: () => object | null, saveDdnsLastRun?: (r: object) => void }, getApexDomains?: () => string[], logger: object }} ctx
 * @returns {Promise<{ ran: true, lastRun: object } | { ran: false, reason?: string }>}
 */
export async function runDdnsSyncOnce(ctx) {
    const { persistence, logger, getApexDomains } = ctx;
    const tick = getRuntimeDdnsTick({ persistence, getApexDomains });

    if (!tick.shouldRun || !tick.apiKey || !tick.secretKey || !tick.domains?.length) {
        return { ran: false, reason: tick.logReason };
    }

    const db = persistence.getDatabaseSync();
    const ipCache = new SqliteIpCache(db);
    const syncService = new SyncService();

    const dnsProvider = new PorkbunDnsProvider({
        apiKey: tick.apiKey,
        secretKey: tick.secretKey,
        apiBaseUrl: tick.porkbunApiBaseUrl,
        logger
    });

    const ipLookup = new HttpIpLookup({
        ipv4Services: tick.ipv4Services,
        ipv6Services: tick.ipv6Services,
        timeoutMs: tick.ipLookupTimeoutMs ?? 8000,
        logger
    });

    const useCase = new DdnsSyncUseCase({
        dnsProvider,
        ipLookup,
        ipCache,
        syncService,
        logger,
        matchNote: tick.matchNote
    });

    let lastRun;
    try {
        const execResult = await useCase.execute(tick.domains);
        lastRun = ddnsLastRunRecordFromExecResult(execResult);
    } catch (err) {
        lastRun = ddnsLastRunRecordFromError(err);
        if (typeof persistence.saveDdnsLastRun === "function") {
            persistence.saveDdnsLastRun(lastRun);
        }
        throw err;
    }

    if (typeof persistence.saveDdnsLastRun === "function") {
        persistence.saveDdnsLastRun(lastRun);
    }

    return { ran: true, lastRun };
}
