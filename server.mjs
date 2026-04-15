import http from "node:http";
import https from "node:https";
import { loadEnvFile } from "node:process";
import { ProxyService } from "./src/infrastructure/http/ProxyService.mjs";
import { ManagementController } from "./src/api/ManagementController.mjs";
import { ManagementServer } from "./src/infrastructure/http/ManagementServer.mjs";
import { SqlitePersistence } from "./src/infrastructure/persistence/SqlitePersistence.mjs";
import { TlsService } from "./src/infrastructure/tls/TlsService.mjs";
import { HealthCheckService } from "./src/infrastructure/http/HealthCheckService.mjs";
import { startDdnsScheduler } from "./src/ddns/infrastructure/DdnsScheduler.mjs";
import { hasLegacyDdnsEnvVars } from "./src/ddns/ddnsConfigResolve.mjs";
import { logger } from "./src/shared/utils/Logger.mjs";
import { hydrateRegistryFromPersistence } from "./src/management/bootstrapFromPersistence.mjs";

try {
    loadEnvFile(".env");
} catch (err) {
    if (err?.code !== "ENOENT") throw err;
}

const TLS_CERT_DIR = process.env.TLS_CERT_DIR;
const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || "./reverse-proxy.db";
const LEGACY_ROUTE_CACHE = process.env.ROUTE_CACHE_FILE || "./route-cache.json";
const MANAGEMENT_SUBDOMAIN = process.env.MANAGEMENT_SUBDOMAIN || "reverse-proxy";
const MANAGEMENT_BASE_DOMAIN = process.env.MANAGEMENT_BASE_DOMAIN || null;
const MANAGEMENT_SECRET = normalizeManagementSecret(process.env.MANAGEMENT_SECRET);
const MANAGEMENT_INTERFACE_PORT = parseManagementInterfacePort(process.env.MANAGEMENT_INTERFACE_PORT);
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || "30000", 10);
const PUBLIC_URL_HTTPS_PREFIX = process.env.PUBLIC_URL_HTTPS_PREFIX || "https";
const PUBLIC_URL_HTTP_PREFIX = process.env.PUBLIC_URL_HTTP_PREFIX || "http";

if (!TLS_CERT_DIR) {
    logger.error("TLS_CERT_DIR must be specified in .env");
    process.exit(1);
}

const persistence = new SqlitePersistence(SQLITE_DB_PATH, {
    legacyRouteCacheFile: LEGACY_ROUTE_CACHE
});

const buildExtraHeaders = req => ({
    "x-forwarded-for": req.socket.remoteAddress,
    "x-forwarded-proto": "https"
});

/** @type {() => void} */
let stopDdns = () => {};

function normalizeManagementSecret(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    return s.length > 0 ? s : null;
}

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

        let managementServer;
        const controller = new ManagementController(registry, persistence, logger, MANAGEMENT_SECRET, {
            publicUrlHttpsPrefix: PUBLIC_URL_HTTPS_PREFIX,
            publicUrlHttpPrefix: PUBLIC_URL_HTTP_PREFIX,
            onRootDomainsUpdated: () => managementServer?.refreshManagementRoute()
        });

        const tlsService = new TlsService(TLS_CERT_DIR, logger);
        managementServer = new ManagementServer(
            MANAGEMENT_SUBDOMAIN,
            () => (MANAGEMENT_BASE_DOMAIN && String(MANAGEMENT_BASE_DOMAIN).trim()) || registry.rootDomain,
            controller,
            logger,
            MANAGEMENT_SECRET,
            MANAGEMENT_INTERFACE_PORT
        );

        const proxyService = new ProxyService(registry, buildExtraHeaders, logger);
        const healthCheckService = new HealthCheckService(registry, logger, HEALTH_CHECK_INTERVAL_MS);

        logger.info({ count: registry.getPersistentRoutes().length }, "Route registry hydrated from SQLite");

        if (hasLegacyDdnsEnvVars(process.env)) {
            logger.warn(
                { event: "ddns_legacy_env_ignored" },
                "DDNS is configured only in SQLite (management UI / PUT /api/v1/ddns). Legacy DDNS_* / PORKBUN_* / API_KEY / SECRET_KEY env vars are ignored."
            );
        }

        await tlsService.start();
        healthCheckService.start();
        await managementServer.start();

        stopDdns = startDdnsScheduler({
            persistence,
            logger,
            getApexDomains: () => registry.getRootDomains()
        });

        const httpServer = http.createServer((req, res) => {
            const host = req.headers.host?.split(":")[0];
            res.writeHead(301, { Location: `https://${host}${req.url}` });
            res.end();
        });

        const httpsServer = https.createServer(
            { SNICallback: (domain, cb) => cb(null, tlsService.secureContext) },
            proxyService.createHttpsHandler()
        );

        httpsServer.on("upgrade", (req, socket, head) => {
            proxyService.handleWebSocketUpgrade(req, socket, head);
        });

        httpServer.listen(80, () => logger.info("HTTP Redirect Server listening on port 80"));
        httpsServer.listen(443, () => logger.info("HTTPS Proxy Server listening on port 443"));

        const shutdown = async signal => {
            logger.info({ signal }, "Shutdown signal received. Closing servers...");

            stopDdns();
            healthCheckService.stop();
            tlsService.stop();
            await managementServer.stop();

            httpServer.close();
            httpsServer.close(() => {
                logger.info("HTTPS Proxy Server closed. Exiting.");
                process.exit(0);
            });

            setTimeout(() => {
                logger.error("Could not close connections in time, forceful exit.");
                process.exit(1);
            }, 10000);
        };

        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
    } catch (err) {
        logger.error({ error: err.message }, "Failed to start server");
        process.exit(1);
    }
}

main();
