import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLocalRequest } from "../../shared/utils/RequestUtils.mjs";
import { readSecretFile } from "../../shared/utils/SecretUtils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MANAGEMENT_LIMITER = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "TOO_MANY_REQUESTS", message: "Too many requests to the management interface, please try again later" } },
});

/**
 * SRP: Bootstraps the Express application for proxy management.
 * Observability: Injects logger for tracking management events.
 */
export class ManagementServer {
    #subdomain;
    #rootDomain;
    #controller;
    #secretFile;
    #logger;
    #app;
    #server;

    constructor(subdomain, rootDomain, controller, logger, secretFile = null) {
        this.#subdomain = subdomain;
        this.#rootDomain = rootDomain;
        this.#controller = controller;
        this.#logger = logger;
        this.#secretFile = secretFile;

        this.#setup();
    }

    get port() {
        if (!this.#server) return null;
        const address = this.#server.address();
        return typeof address === "object" && address ? address.port : null;
    }

    /** Starts the management server on a random available port. */
    async start() {
        return new Promise((resolve, reject) => {
            this.#server = this.#app.listen(0, "127.0.0.1", () => {
                const port = this.port;
                if (!port) {
                    return reject(new Error("Failed to determine management interface port"));
                }

                const host = `${this.#subdomain}.${this.#rootDomain}`;
                const target = `http://127.0.0.1:${port}`;
                
                this.#logger.info({ host, target }, `Management interface started`);
                
                // Register the management interface itself in the registry
                this.#controller.registry.registerEphemeralRoute(host, target);
                
                resolve(port);
            });

            this.#server.on("error", (err) => reject(err));
        });
    }

    /** Gracefully stops the management server. */
    async stop() {
        return new Promise((resolve) => {
            if (!this.#server) return resolve();
            this.#server.close(() => resolve());
        });
    }

    #setup() {
        this.#app = express();
        this.#app.disable("x-powered-by");
        this.#app.use(express.json({ limit: "1mb" }));
        this.#app.use(MANAGEMENT_LIMITER);

        this.#setupRoutes();
        this.#setupErrorHandling();
    }

    #setupRoutes() {
        const router = express.Router();
        const auth = this.#requireAuth.bind(this);
        const local = this.#requireLocal.bind(this);

        // API endpoints
        router.get("/health", (req, res) => this.#controller.getHealth(req, res));
        router.get("/routes", (req, res) => this.#controller.getRoutes(req, res));
        router.post("/scan", local, auth, (req, res) => this.#controller.scanPorts(req, res));
        
        router.post("/reserve", local, auth, (req, res) => this.#controller.reserve(req, res));
        router.post("/rotate-secret", local, auth, (req, res) => this.#controller.rotateSecret(req, res));
        router.delete("/reserve/:subdomain", local, auth, (req, res) => this.#controller.release(req, res));

        // Serve UI static assets at the root
        this.#app.get("/health", (req, res) => this.#controller.getHealth(req, res));
        this.#app.use(express.static(path.join(__dirname, "ui")));
        this.#app.use("/api/v1", router);

        // Fallback for SPA (if we had routing) or 404
        this.#app.use((req, res) => {
            if (req.accepts("html")) {
              res.sendFile(path.join(__dirname, "ui", "index.html"));
            } else {
              res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown management endpoint" } });
            }
        });
    }

    #setupErrorHandling() {
        this.#app.use((error, req, res, next) => {
            if (error instanceof SyntaxError && error.type === "entity.parse.failed") {
                return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Request body must be valid JSON" } });
            }
            this.#logger.error({ event: "mgmt_server_error", error: error.message }, "Management server error");
            res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: "Unexpected server error" } });
        });
    }

    #requireLocal(req, res, next) {
        if (!isLocalRequest(req)) {
            return res.status(403).json({ error: { code: "FORBIDDEN", message: "Management requests are only allowed from localhost" } });
        }
        next();
    }

    #requireAuth(req, res, next) {
        if (!this.#secretFile) return next();
        
        try {
            const secret = readSecretFile(this.#secretFile);
            const authHeader = req.headers["authorization"];
            
            if (authHeader !== `Bearer ${secret}`) {
                return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
            }
            
            next();
        } catch (err) {
            this.#logger.error({ event: "mgmt_auth_error", error: err.message }, "Auth failed");
            res.status(503).json({ error: { code: "SERVICE_UNAVAILABLE", message: "Management authentication is temporarily unavailable" } });
        }
    }
}
