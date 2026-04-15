import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLocalRequest } from "../../shared/utils/RequestUtils.mjs";
import { sendJsonError } from "../../shared/utils/JsonError.mjs";
import { resolutionForManagementError } from "../../api/managementErrorResolutions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Browser-safe module; same file as Node imports (single source). */
const SHARED_APEX_FQDN_MODULE = path.join(__dirname, "../../shared/utils/isValidApexFqdn.mjs");

function parsePositiveInt(raw, fallback) {
    const n = parseInt(String(raw ?? "").trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

const RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.MANAGEMENT_RATE_LIMIT_WINDOW_MS, 60_000);
const RATE_LIMIT_MAX = parsePositiveInt(process.env.MANAGEMENT_RATE_LIMIT_MAX, 300);

const MANAGEMENT_LIMITER = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: {
            code: "TOO_MANY_REQUESTS",
            message: "Too many requests to the management interface, please try again later",
            details: null,
            resolution: resolutionForManagementError("TOO_MANY_REQUESTS")
        }
    }
});

/**
 * SRP: Bootstraps the Express application for proxy management.
 * Observability: Injects logger for tracking management events.
 */
export class ManagementServer {
    #subdomain;
    /** @type {() => string} Resolves apex for management hostname (env MANAGEMENT_BASE_DOMAIN or registry primary). */
    #getManagementBase;
    #controller;
    #managementSecret;
    #listenPort;
    #logger;
    #app;
    #server;

    /**
     * @param {string} subdomain
     * @param {string | (() => string)} managementBaseOrResolver Static apex, or a function returning current apex (tracks DB domain changes).
     * @param {import("../../api/ManagementController.mjs").ManagementController} controller
     * @param {*} logger
     * @param {string | null} [managementSecret]
     * @param {number} [listenPort=0] Port for 127.0.0.1 (0 = OS-assigned ephemeral; server uses MANAGEMENT_INTERFACE_PORT, default 24789).
     */
    constructor(subdomain, managementBaseOrResolver, controller, logger, managementSecret = null, listenPort = 0) {
        this.#subdomain = subdomain;
        this.#getManagementBase =
            typeof managementBaseOrResolver === "function" ? managementBaseOrResolver : () => managementBaseOrResolver;
        this.#controller = controller;
        this.#logger = logger;
        this.#managementSecret = managementSecret;
        this.#listenPort = listenPort;

        this.#setup();
    }

    get port() {
        if (!this.#server) return null;
        const address = this.#server.address();
        return typeof address === "object" && address ? address.port : null;
    }

    /** Starts the management server on 127.0.0.1 (port from constructor; 0 = ephemeral). */
    async start() {
        return new Promise((resolve, reject) => {
            this.#server = this.#app.listen(this.#listenPort, "127.0.0.1", () => {
                const port = this.port;
                if (!port) {
                    return reject(new Error("Failed to determine management interface port"));
                }

                const base = this.#getManagementBase();
                const host = `${this.#subdomain}.${base}`;
                const target = `http://127.0.0.1:${port}`;

                this.#logger.info({ host, target }, `Management interface started`);

                this.#controller.registry.registerManagementInterface(host, target);

                resolve(port);
            });

            this.#server.on("error", (err) => reject(err));
        });
    }

    /** Re-register the management ephemeral route after apex domains change (same listener port). */
    refreshManagementRoute() {
        const port = this.port;
        if (!port) return;
        const base = this.#getManagementBase();
        const host = `${this.#subdomain}.${base}`;
        const target = `http://127.0.0.1:${port}`;
        this.#controller.registry.registerManagementInterface(host, target);
        this.#logger.info({ host, target }, "Management interface route refreshed");
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
        this.#app.set("trust proxy", "loopback");
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
        this.#registerDocsAndHealth(this.#app, router);
        router.get("/domains", (req, res) => this.#controller.getDomains(req, res));
        router.put("/domains", local, auth, (req, res) => this.#controller.putDomains(req, res));
        router.get("/routes", (req, res) => this.#controller.getRoutes(req, res));
        router.get("/network", (req, res) => this.#controller.getNetwork(req, res));
        router.get("/ddns", (req, res) => this.#controller.getDdns(req, res));
        router.put("/ddns", local, auth, (req, res) => this.#controller.putDdns(req, res));
        router.delete("/ddns", local, auth, (req, res) => this.#controller.deleteDdns(req, res));
        router.post("/scan", local, auth, (req, res) => this.#controller.scanPorts(req, res));

        router.post("/reserve", local, auth, (req, res) => this.#controller.reserve(req, res));
        router.delete("/reserve/:subdomain", local, auth, (req, res) => this.#controller.release(req, res));
        router.delete("/process/:port", local, auth, (req, res) => this.#controller.killProcess(req, res));

        // Serve UI static assets at the root
        this.#app.get("/llms.txt", (req, res) => this.#controller.getLlmInstructions(req, res));
        this.#app.get("/isValidApexFqdn.mjs", (req, res) => {
            res.type("application/javascript");
            res.sendFile(SHARED_APEX_FQDN_MODULE);
        });
        this.#app.use(express.static(path.join(__dirname, "ui")));
        this.#app.use("/api/v1", router);

        // Fallback for SPA (if we had routing) or 404
        this.#app.use((req, res) => {
            if (req.accepts("html")) {
              res.sendFile(path.join(__dirname, "ui", "index.html"));
            } else {
              sendJsonError(
                    res,
                    404,
                    "NOT_FOUND",
                    "Unknown management endpoint",
                    null,
                    resolutionForManagementError("NOT_FOUND")
                );
            }
        });
    }

    /**
     * Health + OpenAPI at `/api/v1/...` and same paths at site root (convenience for docs and probes).
     * @param {import("express").Express} app
     * @param {import("express").Router} router
     */
    #registerDocsAndHealth(app, router) {
        const health = (req, res) => this.#controller.getHealth(req, res);
        const openApi = (req, res) => this.#controller.getOpenApi(req, res);
        router.get("/health", health);
        router.get("/status", health);
        router.get("/openapi.yaml", openApi);
        app.get("/openapi.yaml", openApi);
        app.get("/health", health);
    }

    #setupErrorHandling() {
        this.#app.use((error, req, res, next) => {
            if (error instanceof SyntaxError && error.type === "entity.parse.failed") {
                return sendJsonError(
                    res,
                    400,
                    "BAD_REQUEST",
                    "Request body must be valid JSON",
                    null,
                    resolutionForManagementError("BAD_REQUEST")
                );
            }
            this.#logger.error({ event: "mgmt_server_error", error: error.message }, "Management server error");
            sendJsonError(
                res,
                500,
                "INTERNAL_SERVER_ERROR",
                "Unexpected server error",
                null,
                resolutionForManagementError("INTERNAL_SERVER_ERROR")
            );
        });
    }

    #requireLocal(req, res, next) {
        if (!isLocalRequest(req)) {
            return sendJsonError(
                res,
                403,
                "FORBIDDEN",
                "Management requests are only allowed from localhost",
                null,
                resolutionForManagementError("FORBIDDEN")
            );
        }
        next();
    }

    #requireAuth(req, res, next) {
        if (!this.#managementSecret) return next();

        const authHeader = req.headers["authorization"];
        if (authHeader !== `Bearer ${this.#managementSecret}`) {
            return sendJsonError(
                res,
                401,
                "UNAUTHORIZED",
                "Unauthorized",
                null,
                resolutionForManagementError("UNAUTHORIZED")
            );
        }

        next();
    }
}
