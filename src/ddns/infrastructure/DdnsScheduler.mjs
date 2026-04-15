import { PorkbunDnsProvider } from "./adapters/PorkbunDnsProvider.mjs";
import { HttpIpLookup } from "./adapters/HttpIpLookup.mjs";
import { SqliteIpCache } from "./adapters/SqliteIpCache.mjs";
import { SyncService } from "../domain/services/SyncService.mjs";
import { DdnsSyncUseCase } from "../application/DdnsSyncUseCase.mjs";
import { getRuntimeDdnsTick } from "../ddnsConfigResolve.mjs";

/**
 * Wires DDNS: reloads config from SQLite on each cycle so management UI changes apply without restart.
 * @param {{ persistence: { getDatabaseSync: () => import("node:sqlite").DatabaseSync, getDdnsSettings?: () => object | null }, logger: object, getApexDomains?: () => string[] }} ctx
 * @returns {() => void}
 */
export function startDdnsScheduler(ctx) {
    const { persistence, logger, getApexDomains } = ctx;

    const db = persistence.getDatabaseSync();
    const ipCache = new SqliteIpCache(db);
    const syncService = new SyncService();

    let stopped = false;
    let timeoutId = null;
    let lastSkipLog = "";

    const logSkipOnce = (reason, message) => {
        const key = `${reason}:${message || ""}`;
        if (key === lastSkipLog) return;
        lastSkipLog = key;
        if (reason === "ddns_disabled") {
            logger.info({ event: reason }, message || "DDNS is disabled");
        } else if (reason === "invalid_stored_ddns") {
            logger.warn({ event: reason, message }, "Invalid DDNS row in SQLite; fix via PUT /api/v1/ddns or DELETE to clear");
        } else if (reason === "ddns_not_configured") {
            logger.info({ event: reason }, message || "DDNS is not configured");
        } else {
            logger.warn({ event: reason }, message || "DDNS scheduler idle");
        }
    };

    const schedule = ms => {
        if (stopped) return;
        if (timeoutId) clearTimeout(timeoutId);
        const delay = Math.max(1000, Math.min(ms, 86_400_000));
        timeoutId = setTimeout(() => {
            void runCycle();
        }, delay);
    };

    async function runCycle() {
        if (stopped) return;

        const tick = getRuntimeDdnsTick({ persistence, getApexDomains });

        if (tick.logReason && !tick.shouldRun) {
            logSkipOnce(tick.logReason, tick.logMessage);
        } else {
            lastSkipLog = "";
        }

        if (tick.shouldRun && tick.apiKey && tick.secretKey && tick.domains?.length) {
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

            try {
                await useCase.execute(tick.domains);
            } catch (err) {
                logger.error({ event: "ddns_interval_error", err: err.message }, err.stack);
            }
        }

        schedule(tick.nextDelayMs ?? 60_000);
    }

    logger.info({ event: "ddns_scheduler_loop_start" }, "DDNS scheduler loop started (config from SQLite each cycle)");
    schedule(0);

    return () => {
        stopped = true;
        if (timeoutId) clearTimeout(timeoutId);
        logger.info({ event: "ddns_scheduler_stopped" }, "DDNS scheduler stopped");
    };
}
