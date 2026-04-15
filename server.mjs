import "./src/config/bootstrapEnv.mjs";
import http from "node:http";
import https from "node:https";
import { DEFAULT_SQLITE_DB_PATH } from "./src/config/applyServerSettingsToEnv.mjs";
import { ProxyService } from "./src/infrastructure/http/ProxyService.mjs";
import { ManagementController } from "./src/api/ManagementController.mjs";
import { ManagementServer } from "./src/infrastructure/http/ManagementServer.mjs";
import { SqlitePersistence } from "./src/infrastructure/persistence/SqlitePersistence.mjs";
import { TlsService } from "./src/infrastructure/tls/TlsService.mjs";
import { HealthCheckService } from "./src/infrastructure/http/HealthCheckService.mjs";
import { startDdnsScheduler } from "./src/ddns/infrastructure/DdnsScheduler.mjs";
import { logger } from "./src/shared/utils/Logger.mjs";
import { hydrateRegistryFromPersistence } from "./src/management/bootstrapFromPersistence.mjs";
import {
    isDataPlaneTlsPeerSameHost,
    MANAGEMENT_DATA_PLANE_SAME_HOST_HEADER,
    refreshManagementPublicEgressCache,
    setPersistedDdnsPublicIpsForLocalOperator
} from "./src/shared/utils/RequestUtils.mjs";

/** From `.env` + SQLite `server_settings` (see `applyServerSettingsToEnv.mjs`). May be empty; management UI still starts. */
const TLS_CERT_DIR = (process.env.TLS_CERT_DIR ?? "").trim();
const SQLITE_DB_PATH = DEFAULT_SQLITE_DB_PATH;
const MANAGEMENT_SUBDOMAIN = process.env.MANAGEMENT_SUBDOMAIN || "reverse-proxy";
const MANAGEMENT_BASE_DOMAIN = process.env.MANAGEMENT_BASE_DOMAIN || null;
const MANAGEMENT_INTERFACE_PORT = parseManagementInterfacePort(process.env.MANAGEMENT_INTERFACE_PORT);
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || "30000", 10);
const PUBLIC_URL_HTTPS_PREFIX = process.env.PUBLIC_URL_HTTPS_PREFIX || "https";
const PUBLIC_URL_HTTP_PREFIX = process.env.PUBLIC_URL_HTTP_PREFIX || "http";

const persistence = new SqlitePersistence(SQLITE_DB_PATH);

const buildExtraHeaders = req => {
    const peer = req.socket?.remoteAddress;
    return {
        "x-forwarded-for": peer,
        "x-forwarded-proto": "https",
        [MANAGEMENT_DATA_PLANE_SAME_HOST_HEADER]: isDataPlaneTlsPeerSameHost(peer) ? "1" : "0"
    };
};

/** @type {() => void} */
let stopDdns = () => {};

/** Default 24789; invalid values fall back to 24789. */
function parseManagementInterfacePort(raw) {
    if (raw == null || String(raw).trim() === "") return 24789;
    const n = parseInt(String(raw).trim(), 10);
    if (Number.isInteger(n) && n >= 0 && n <= 65535) return n;
    logger.warn({ raw }, "Invalid MANAGEMENT_INTERFACE_PORT; using 24789");
    return 24789;
}

async function main() {
    try {
        const { registry } = await hydrateRegistryFromPersistence(persistence, process.env, {
            defaultRootDomains: "javagrant.ac.nz",
            logger: {
                info: (o, m) => logger.info(o, m),
                warn: (o, m) => logger.warn(o, m),
                error: (o, m) => logger.error(o, m)
            }
        });

        /** When false, ports 80/443 and route proxying are off; loopback management UI/API still runs. */
        const dataPlaneState = { active: false };
        let tlsService = null;

        if (TLS_CERT_DIR) {
            tlsService = new TlsService(TLS_CERT_DIR, logger);
            try {
                await tlsService.start();
                dataPlaneState.active = true;
            } catch (err) {
                logger.error(
                    {
                        err: err?.message,
                        path: TLS_CERT_DIR,
                        event: "tls_start_failed"
                    },
                    "TLS did not load (missing or invalid cert files). Management UI stays up; fix tlsCertDir / TLS_CERT_DIR and restart."
                );
                tlsService = null;
                dataPlaneState.active = false;
            }
        } else {
            logger.warn(
                { event: "tls_cert_dir_unset" },
                "TLS_CERT_DIR is empty: HTTPS proxy and port 80 redirect are disabled. Set tlsCertDir in Settings (SQLite) or TLS_CERT_DIR, then restart."
            );
        }

        let managementServer;
        const controller = new ManagementController(registry, persistence, logger, {
            publicUrlHttpsPrefix: PUBLIC_URL_HTTPS_PREFIX,
            publicUrlHttpPrefix: PUBLIC_URL_HTTP_PREFIX,
            onRootDomainsUpdated: () => managementServer?.refreshManagementRoute(),
            isDataPlaneActive: () => dataPlaneState.active
        });

        let proxyService = null;
        let healthCheckService = null;
        if (dataPlaneState.active && tlsService) {
            proxyService = new ProxyService(registry, buildExtraHeaders, logger);
            healthCheckService = new HealthCheckService(registry, logger, HEALTH_CHECK_INTERVAL_MS);
        }

        managementServer = new ManagementServer(
            MANAGEMENT_SUBDOMAIN,
            () => (MANAGEMENT_BASE_DOMAIN && String(MANAGEMENT_BASE_DOMAIN).trim()) || registry.rootDomain,
            controller,
            logger,
            MANAGEMENT_INTERFACE_PORT,
            { sqliteDbPath: SQLITE_DB_PATH }
        );

        logger.info(
            { count: registry.getPersistentRoutes().length, dataPlaneActive: dataPlaneState.active },
            "Route registry hydrated from SQLite"
        );

        if (healthCheckService) {
            healthCheckService.start();
        }

        await managementServer.start();

        try {
            await refreshManagementPublicEgressCache();
        } catch {
            /* ignore */
        }
        try {
            setPersistedDdnsPublicIpsForLocalOperator(
                persistence.getDdnsPublicIpAddressesForLocalOperatorHint()
            );
        } catch {
            /* ignore */
        }
        const ddnsMetaHintTimer = setInterval(() => {
            try {
                setPersistedDdnsPublicIpsForLocalOperator(
                    persistence.getDdnsPublicIpAddressesForLocalOperatorHint()
                );
            } catch {
                /* ignore */
            }
        }, 120_000);
        ddnsMetaHintTimer.unref?.();

        if (!dataPlaneState.active) {
            logger.warn(
                { event: "management_only_mode" },
                "Management API/UI on loopback only until TLS is configured and the process is restarted."
            );
        }

        stopDdns = startDdnsScheduler({
            persistence,
            logger,
            getApexDomains: () => registry.getRootDomains(),
            getDnsConsoleContext: () => ({
                dnsConsole: persistence.getRootDomainConfig?.()?.dnsConsole ?? null,
                env: process.env
            })
        });

        /** @type {import("node:http").Server | null} */
        let httpServer = null;
        /** @type {import("node:https").Server | null} */
        let httpsServer = null;

        if (dataPlaneState.active && tlsService && proxyService) {
            httpServer = http.createServer((req, res) => {
                const host = req.headers.host?.split(":")[0];
                res.writeHead(301, { Location: `https://${host}${req.url}` });
                res.end();
            });

            httpsServer = https.createServer(
                { SNICallback: (domain, cb) => cb(null, tlsService.secureContext) },
                proxyService.createHttpsHandler()
            );

            httpsServer.on("upgrade", (req, socket, head) => {
                proxyService.handleWebSocketUpgrade(req, socket, head);
            });

            httpServer.listen(80, () => logger.info("HTTP Redirect Server listening on port 80"));
            httpsServer.listen(443, () => logger.info("HTTPS Proxy Server listening on port 443"));
        }

        let shutdownInvocation = 0;
        const shutdown = async signal => {
            const t0 = Date.now();
            const invocation = ++shutdownInvocation;
            /** @param {string} message @param {string} hypothesisId @param {Record<string, unknown>} [extra] */
            const dbg = (message, hypothesisId, extra = {}) => {
                // #region agent log
                fetch("http://127.0.0.1:7264/ingest/41b103da-6258-4e05-b5ff-6d1a76fe4cff", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "bfb84f" },
                    body: JSON.stringify({
                        sessionId: "bfb84f",
                        runId: "pre-fix",
                        hypothesisId,
                        location: "server.mjs:shutdown",
                        message,
                        data: { signal, invocation, ms: Date.now() - t0, ...extra },
                        timestamp: Date.now()
                    })
                }).catch(() => {});
                // #endregion
            };

            dbg("shutdown_enter", "A");

            logger.info({ signal }, "Shutdown signal received. Closing servers...");

            stopDdns();
            dbg("after_stopDdns", "E");
            if (healthCheckService) {
                healthCheckService.stop();
            }
            if (tlsService) {
                tlsService.stop();
            }
            dbg("after_sync_stops_before_management", "D");

            await managementServer.stop();
            dbg("after_management_stop", "B");

            if (httpServer) {
                httpServer.close();
            }
            dbg("after_http_close_called", "C");

            if (httpsServer) {
                httpsServer.close(() => {
                    dbg("https_close_callback", "C", { totalMs: Date.now() - t0 });
                    logger.info("HTTPS Proxy Server closed. Exiting.");
                    process.exit(0);
                });
                dbg("after_https_close_called", "C");
            } else {
                logger.info("Exiting.");
                process.exit(0);
            }

            setTimeout(() => {
                logger.error("Could not close connections in time, forceful exit.");
                process.exit(1);
            }, 10000);
        };

        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
    } catch (err) {
        logger.error({ err, event: "server_start_failed" }, "Failed to start server");
        process.exit(1);
    }
}

main();
