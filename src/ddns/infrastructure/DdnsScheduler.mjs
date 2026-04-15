import { getRuntimeDdnsTick } from "../ddnsConfigResolve.mjs";
import { runDdnsSyncOnce } from "../runDdnsSyncOnce.mjs";

/**
 * Wires DDNS: reloads config from SQLite on each cycle so management UI changes apply without restart.
 * @param {{ persistence: { getDatabaseSync: () => import("node:sqlite").DatabaseSync, getDdnsSettings?: () => object | null }, logger: object, getApexDomains?: () => string[] }} ctx
 * @returns {() => void}
 */
export function startDdnsScheduler(ctx) {
    const { persistence, logger, getApexDomains } = ctx;

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
            try {
                await runDdnsSyncOnce({ persistence, getApexDomains, logger });
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
