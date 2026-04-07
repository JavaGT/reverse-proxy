import http from "node:http";
import https from "node:https";
import dotenv from "dotenv";
import { RouteRegistry } from "./src/domain/RouteRegistry.mjs";
import { ProxyService } from "./src/infrastructure/http/ProxyService.mjs";
import { ManagementController } from "./src/api/ManagementController.mjs";
import { ManagementServer } from "./src/infrastructure/http/ManagementServer.mjs";
import { FilePersistence } from "./src/infrastructure/persistence/FilePersistence.mjs";
import { TlsService } from "./src/infrastructure/tls/TlsService.mjs";
import { HealthCheckService } from "./src/infrastructure/http/HealthCheckService.mjs";
import { logger } from "./src/shared/utils/Logger.mjs";

dotenv.config();

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || "javagrant.ac.nz";
const TLS_CERT_DIR = process.env.TLS_CERT_DIR;
const ROUTE_CACHE_FILE = process.env.ROUTE_CACHE_FILE || "./route-cache.json";
const MANAGEMENT_SUBDOMAIN = process.env.MANAGEMENT_SUBDOMAIN || "reverse-proxy";
const MANAGEMENT_SECRET_FILE = process.env.MANAGEMENT_SECRET_FILE;
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || "30000", 10);

if (!TLS_CERT_DIR) {
    logger.error("TLS_CERT_DIR must be specified in .env");
    process.exit(1);
}

// 1. Domain & Persistence setup
const persistence = new FilePersistence(ROUTE_CACHE_FILE);
const registry = new RouteRegistry(ROOT_DOMAIN);

// 2. Application/API setup
const controller = new ManagementController(registry, persistence, logger, MANAGEMENT_SECRET_FILE);

// 3. Infrastructure setup
const tlsService = new TlsService(TLS_CERT_DIR, logger);
const managementServer = new ManagementServer(
    MANAGEMENT_SUBDOMAIN, 
    ROOT_DOMAIN, 
    controller, 
    logger, 
    MANAGEMENT_SECRET_FILE
);

const buildExtraHeaders = (req) => {
    return {
        "x-forwarded-for": req.socket.remoteAddress,
        "x-forwarded-proto": "https",
    };
};

const proxyService = new ProxyService(registry, buildExtraHeaders, logger);
const healthCheckService = new HealthCheckService(registry, logger, HEALTH_CHECK_INTERVAL_MS);

async function main() {
    try {
        // Hydrate routing from disk
        const initialRoutes = await persistence.load();
        registry.hydrate(initialRoutes);
        logger.info({ count: initialRoutes.length }, "Route registry hydrated from disk");

        // Start TLS reloader
        await tlsService.start();

        // Start Health Check Service
        healthCheckService.start();

        // Start Management API
        await managementServer.start();

        // 4. Proxy Servers initialization
        
        // HTTP Server: Redirects everything to HTTPS
        const httpServer = http.createServer((req, res) => {
            const host = req.headers.host?.split(":")[0];
            res.writeHead(301, { Location: `https://${host}${req.url}` });
            res.end();
        });

        // HTTPS Server: Main Proxy logic
        const httpsServer = https.createServer(
            { SNICallback: (domain, cb) => cb(null, tlsService.secureContext) },
            proxyService.createHttpsHandler()
        );

        httpsServer.on("upgrade", (req, socket, head) => {
            proxyService.handleWebSocketUpgrade(req, socket, head);
        });

        // Start listening
        httpServer.listen(80, () => logger.info("HTTP Redirect Server listening on port 80"));
        httpsServer.listen(443, () => logger.info("HTTPS Proxy Server listening on port 443"));

        // 5. Graceful shutdown handler
        const shutdown = async (signal) => {
            logger.info({ signal }, "Shutdown signal received. Closing servers...");
            
            healthCheckService.stop();
            tlsService.stop();
            await managementServer.stop();
            
            httpServer.close();
            httpsServer.close(() => {
                logger.info("HTTPS Proxy Server closed. Exiting.");
                process.exit(0);
            });

            // Force exit if not closed in time
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