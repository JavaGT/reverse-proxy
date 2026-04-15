import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import session from "express-session";
import { setupAuth, authRouter, SQLiteSessionStore } from "@javagt/express-easy-auth";
import {
    getManagementPublicEgressRefreshIntervalMs,
    isLocalRequest,
    refreshManagementPublicEgressCache,
    resolveManagementLocalOperator
} from "../../shared/utils/RequestUtils.mjs";
import { sendJsonError } from "../../shared/utils/JsonError.mjs";
import { resolutionForManagementError } from "../../api/managementErrorResolutions.mjs";
import { createManagementGetWebAuthnOptions } from "./managementWebAuthnDynamic.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Browser-safe module; same file as Node imports (single source). */
const SHARED_APEX_FQDN_MODULE = path.join(__dirname, "../../shared/utils/isValidApexFqdn.mjs");

function parsePositiveInt(raw, fallback) {
    const n = parseInt(String(raw ?? "").trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

function createManagementRateLimiter() {
    const windowMs = parsePositiveInt(process.env.MANAGEMENT_RATE_LIMIT_WINDOW_MS, 60_000);
    const max = parsePositiveInt(process.env.MANAGEMENT_RATE_LIMIT_MAX, 300);
    return rateLimit({
        windowMs,
        max,
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
}

/**
 * Bootstraps the Express application for proxy management.
 */
export class ManagementServer {
    #subdomain;
    /** @type {() => string} Resolves apex for management hostname (env MANAGEMENT_BASE_DOMAIN or registry primary). */
    #getManagementBase;
    #controller;
    #listenPort;
    /** @type {{ sqliteDbPath?: string }} */
    #options;
    #logger;
    #app;
    #server;
    /** @type {ReturnType<typeof setInterval> | null} */
    #egressRefreshTimer = null;

    /**
     * @param {string} subdomain
     * @param {string | (() => string)} managementBaseOrResolver Static apex, or a function returning current apex (tracks DB domain changes).
     * @param {import("../../api/ManagementController.mjs").ManagementController} controller
     * @param {*} logger
     * @param {number} [listenPort=0] Port for 127.0.0.1 (0 = OS-assigned ephemeral; server uses MANAGEMENT_INTERFACE_PORT, default 24789).
     * @param {{ sqliteDbPath?: string }} [options] Optional `sqliteDbPath` to derive default `@javagt/express-easy-auth` data dir beside the proxy DB.
     */
    constructor(subdomain, managementBaseOrResolver, controller, logger, listenPort = 0, options = {}) {
        this.#subdomain = subdomain;
        this.#getManagementBase =
            typeof managementBaseOrResolver === "function" ? managementBaseOrResolver : () => managementBaseOrResolver;
        this.#controller = controller;
        this.#logger = logger;
        this.#listenPort = listenPort;
        this.#options = options;

        this.#setup();
    }

    get port() {
        if (!this.#server) return null;
        const address = this.#server.address();
        return typeof address === "object" && address != null ? address.port : null;
    }

    /** @param {import("node:net").AddressInfo | string | null} address */
    #formatBoundAddress(address) {
        if (address == null) return "null";
        if (typeof address === "string") return `"${address}" (named pipe or Unix socket)`;
        return JSON.stringify(address);
    }

    /** Starts the management server on 127.0.0.1 (port from constructor; 0 = ephemeral). */
    async start() {
        return new Promise((resolve, reject) => {
            let settled = false;
            const failOnce = (err, source) => {
                if (settled) return;
                settled = true;
                this.#logger.error(
                    {
                        err,
                        event: "management_listen_error",
                        requestedListenPort: this.#listenPort,
                        bindHost: "127.0.0.1",
                        source
                    },
                    "Management server failed to bind or listen on loopback"
                );
                reject(err);
            };

            /**
             * Express `app.listen(..., fn)` wraps `fn` with `once` and registers `server.once("error", fn)`.
             * On bind failure (e.g. EADDRINUSE), `fn(err)` runs — not the "listening" path — so
             * `server.address()` is still null. Treat any truthy first argument as the listen error.
             */
            this.#server = this.#app.listen(this.#listenPort, "127.0.0.1", async maybeErr => {
                if (maybeErr) {
                    return failOnce(maybeErr, "express_listen_callback");
                }

                const address = this.#server.address();
                let port = typeof address === "object" && address != null ? address.port : null;
                if (port == null && this.#listenPort > 0 && this.#server.listening) {
                    this.#logger.warn(
                        {
                            event: "management_address_fallback",
                            requestedListenPort: this.#listenPort,
                            serverAddress: address
                        },
                        "server.address() was null while listening; using requested port"
                    );
                    port = this.#listenPort;
                }
                if (port == null) {
                    const addressKind =
                        address === null
                            ? "null"
                            : typeof address === "string"
                              ? "pipe_or_unix_socket"
                              : "non_object";
                    this.#logger.error(
                        {
                            event: "management_listen_port_unknown",
                            requestedListenPort: this.#listenPort,
                            bindHost: "127.0.0.1",
                            serverAddress: address,
                            addressKind,
                            serverListening: this.#server.listening
                        },
                        "Management server listening event fired but bound address has no TCP port"
                    );
                    if (!settled) {
                        settled = true;
                        reject(
                            new Error(
                                `Failed to determine management interface port (requested ${this.#listenPort} on 127.0.0.1; server.address()=${this.#formatBoundAddress(address)})`
                            )
                        );
                    }
                    return;
                }

                if (settled) return;
                settled = true;

                const base = this.#getManagementBase();
                const host = `${this.#subdomain}.${base}`;
                const target = `http://127.0.0.1:${port}`;

                this.#logger.info({ host, target }, `Management interface started`);

                this.#controller.registry.registerManagementInterface(host, target);

                try {
                    const result = await Promise.race([
                        refreshManagementPublicEgressCache(),
                        new Promise((_, reject) =>
                            setTimeout(
                                () => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })),
                                5000
                            )
                        )
                    ]);
                    if (!result?.skipped) {
                        this.#logger.info(
                            {
                                event: "mgmt_public_egress_cached",
                                ipv4Comparable: result?.ipv4 ?? null,
                                ipv6Comparable: result?.ipv6 ?? null
                            },
                            "Public egress IP cache warmed for local-operator hairpin matching"
                        );
                    }
                } catch (e) {
                    if (e?.code === "ETIMEOUT") {
                        this.#logger.debug(
                            { event: "mgmt_public_egress_cache_slow" },
                            "Egress IP lookup did not finish within 5s; continuing in background"
                        );
                    }
                    void refreshManagementPublicEgressCache();
                }

                if (this.#egressRefreshTimer != null) {
                    clearInterval(this.#egressRefreshTimer);
                    this.#egressRefreshTimer = null;
                }
                const egressInterval = setInterval(() => {
                    void refreshManagementPublicEgressCache();
                }, getManagementPublicEgressRefreshIntervalMs());
                egressInterval.unref?.();
                this.#egressRefreshTimer = egressInterval;

                resolve(port);
            });

            this.#server.on("error", err => failOnce(err, "server_error_event"));
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
        if (this.#egressRefreshTimer != null) {
            clearInterval(this.#egressRefreshTimer);
            this.#egressRefreshTimer = null;
        }
        return new Promise(resolve => {
            if (!this.#server) return resolve();
            this.#server.close(() => resolve());
        });
    }

    #setup() {
        this.#app = express();
        this.#app.use((req, res, next) => {
            req.mgmtLocalOperator = resolveManagementLocalOperator(req);
            next();
        });
        const trustExplicit = process.env.MANAGEMENT_TRUST_PROXY;
        this.#app.set(
            "trust proxy",
            trustExplicit === "1" || trustExplicit === "true" ? 1 : "loopback"
        );
        this.#app.set("etag", false);
        this.#app.disable("x-powered-by");
        this.#app.use(express.json({ limit: "1mb" }));
        this.#setupManagementAuth();
        this.#app.use(createManagementRateLimiter());

        this.#setupRoutes();
        this.#setupErrorHandling();
    }

    #resolveAuthDataDir() {
        const fromEnv = process.env.MANAGEMENT_AUTH_DATA_DIR?.trim();
        if (fromEnv) return path.resolve(fromEnv);
        if (this.#options?.sqliteDbPath) {
            return path.join(path.dirname(path.resolve(this.#options.sqliteDbPath)), "management-auth");
        }
        return path.join(process.cwd(), "management-auth");
    }

    #setupManagementAuth() {
        const authDataDir = this.#resolveAuthDataDir();
        const sessionSecret =
            process.env.MANAGEMENT_SESSION_SECRET?.trim() || "development-management-session-secret";
        if (!process.env.MANAGEMENT_SESSION_SECRET?.trim()) {
            this.#logger.warn(
                { event: "mgmt_session_secret_default" },
                "MANAGEMENT_SESSION_SECRET unset; using a fixed dev session secret (set MANAGEMENT_SESSION_SECRET in production)"
            );
        }
        const rpHost =
            process.env.MANAGEMENT_AUTH_RP_ID?.trim() ||
            process.env.MANAGEMENT_BASE_DOMAIN?.trim() ||
            "localhost";
        const defaultPort = this.#listenPort > 0 ? this.#listenPort : 24789;
        const origin =
            process.env.MANAGEMENT_AUTH_ORIGIN?.trim() || `http://127.0.0.1:${defaultPort}`;
        const webAuthnFallback = { rpID: rpHost, origin, domain: rpHost };

        const easyLogger = {
            error: (msg, meta) => this.#logger.error({ ...(meta && typeof meta === "object" ? meta : {}), event: "mgmt_easy_auth" }, String(msg)),
            warn: (msg, meta) => this.#logger.warn({ ...(meta && typeof meta === "object" ? meta : {}), event: "mgmt_easy_auth" }, String(msg)),
            info: (msg, meta) => this.#logger.info({ ...(meta && typeof meta === "object" ? meta : {}), event: "mgmt_easy_auth" }, String(msg)),
            debug: (msg, meta) => this.#logger.debug({ ...(meta && typeof meta === "object" ? meta : {}), event: "mgmt_easy_auth" }, String(msg))
        };

        setupAuth(this.#app, {
            dataDir: authDataDir,
            exposeErrors: process.env.NODE_ENV !== "production",
            sdkRoute: "/management-auth-sdk.js",
            logger: easyLogger,
            enableApiKeys: false,
            getWebAuthnOptions: createManagementGetWebAuthnOptions(webAuthnFallback),
            config: {
                domain: rpHost,
                rpName: "Reverse proxy management",
                rpID: rpHost,
                origin
            }
        });

        this.#app.post("/api/v1/auth/logout", (req, res, next) => {
            if (req.mgmtLocalOperator?.sameMachine) {
                return res.status(204).end();
            }
            next();
        });

        this.#app.use(cookieParser());
        this.#app.use(
            session({
                name: "mgmt.sid",
                secret: sessionSecret,
                store: new SQLiteSessionStore(),
                resave: false,
                saveUninitialized: false,
                cookie: {
                    httpOnly: true,
                    sameSite: "lax",
                    secure: process.env.MANAGEMENT_AUTH_COOKIE_SECURE === "1"
                }
            })
        );
        this.#app.use(
            "/api/v1/auth",
            (req, res, next) => {
                if (req.method !== "POST" || req.path !== "/register") return next();
                const expected = process.env.MANAGEMENT_REGISTRATION_SECRET?.trim();
                if (!expected) {
                    return sendJsonError(
                        res,
                        503,
                        "NOT_CONFIGURED",
                        "Registration is disabled (MANAGEMENT_REGISTRATION_SECRET not set)",
                        null,
                        resolutionForManagementError("REGISTRATION_NOT_CONFIGURED")
                    );
                }
                const provided = req.body?.registrationSecret;
                if (typeof provided !== "string" || provided.trim() !== expected) {
                    return sendJsonError(
                        res,
                        403,
                        "FORBIDDEN",
                        "Invalid or missing registration secret",
                        null,
                        resolutionForManagementError("INVALID_REGISTRATION_SECRET")
                    );
                }
                try {
                    delete req.body.registrationSecret;
                } catch {
                    /* ignore */
                }
                next();
            },
            authRouter
        );
    }

    #setupRoutes() {
        this.#app.use((req, res, next) => this.#gateSessionUnlessSameMachine(req, res, next));
        this.#app.use((req, res, next) => {
            const audit = req.mgmtLocalOperator;
            if (
                process.env.MANAGEMENT_DEBUG_LOCAL_OPERATOR === "1" ||
                process.env.MANAGEMENT_DEBUG_LOCAL_OPERATOR === "true"
            ) {
                this.#logger.debug(
                    {
                        event: "mgmt_local_operator_audit",
                        method: req.method,
                        path: req.path,
                        sameMachine: audit.sameMachine,
                        reason: audit.reason,
                        socketPeer: audit.socketPeer,
                        expressIp: audit.expressIp,
                        forwardedFor: audit.forwardedFor,
                        xRealIp: audit.xRealIp,
                        effectiveClientIp: audit.effectiveClientIp,
                        candidateChecks: audit.candidateChecks,
                        machineIfaceCount: audit.machineIfaceCount,
                        extraEnvIpCount: audit.extraEnvIpCount,
                        egressIpv4Comparable: audit.egressIpv4Comparable,
                        egressIpv6Comparable: audit.egressIpv6Comparable,
                        autoPublicEgressDisabled: audit.autoPublicEgressDisabled,
                        trustProxyEnv: process.env.MANAGEMENT_TRUST_PROXY
                    },
                    "management local operator check"
                );
            }
            if (audit.sameMachine) {
                res.setHeader("X-Management-Local-Operator", "1");
            }
            next();
        });

        const router = express.Router();
        router.use((req, res, next) => {
            res.setHeader("Cache-Control", "no-store, private");
            next();
        });
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
        router.post("/ddns/sync", local, auth, (req, res) => this.#controller.postDdnsSync(req, res));
        router.post("/scan", local, auth, (req, res) => this.#controller.scanPorts(req, res));

        router.post("/reserve", local, auth, (req, res) => this.#controller.reserve(req, res));
        router.delete("/reserve/:subdomain", local, auth, (req, res) => this.#controller.release(req, res));
        router.delete("/process/:port", local, auth, (req, res) => this.#controller.killProcess(req, res));
        router.get("/registration-secret", auth, (req, res) => this.#controller.getRegistrationSecret(req, res));
        router.get("/accounts", auth, (req, res) => this.#controller.getAccounts(req, res));
        router.delete("/accounts/:userId", auth, (req, res) => this.#controller.deleteAccount(req, res));
        router.get("/settings", auth, (req, res) => this.#controller.getServerSettings(req, res));
        router.put("/settings", local, auth, (req, res) => this.#controller.putServerSettings(req, res));

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
        if (req.mgmtLocalOperator?.sameMachine) return next();
        if (req.session?.userId) {
            req.userId = req.session.userId;
            return next();
        }
        return sendJsonError(
            res,
            401,
            "UNAUTHORIZED",
            "Authentication required",
            null,
            resolutionForManagementError("UNAUTHORIZED")
        );
    }

    /** Session cookie required (same-machine operators without sign-in are not enough). */
    #requireSessionUser(req, res, next) {
        if (req.session?.userId) {
            req.userId = req.session.userId;
            return next();
        }
        return sendJsonError(
            res,
            401,
            "UNAUTHORIZED",
            "Sign in required to access this resource",
            null,
            resolutionForManagementError("UNAUTHORIZED")
        );
    }

    /**
     * Remote clients need a valid session for every path except auth, login, and the auth SDK.
     * Same-machine (local operator) clients skip the gate.
     */
    #gateSessionUnlessSameMachine(req, res, next) {
        if (req.mgmtLocalOperator?.sameMachine) return next();

        const p = req.path || "";
        if (
            p.startsWith("/api/v1/auth") ||
            p === "/management-auth-sdk.js" ||
            p === "/login.html" ||
            p === "/register.html"
        ) {
            return next();
        }

        // Unauthenticated probes (login.html checks /api/v1/health for X-Management-Local-Operator).
        const m = req.method;
        if (
            (m === "GET" || m === "HEAD") &&
            (p === "/api/v1/health" || p === "/api/v1/status" || p === "/health")
        ) {
            return next();
        }

        // Stylesheets and JS modules served from `ui/` (login/register need CSS + SDK without a session).
        const publicUiExt = new Set([".css", ".js", ".mjs", ".map"]);
        if (
            (m === "GET" || m === "HEAD") &&
            !p.startsWith("/api/") &&
            publicUiExt.has(path.extname(p).toLowerCase())
        ) {
            return next();
        }

        if (req.session?.userId) {
            req.userId = req.session.userId;
            return next();
        }

        const prefersHtml =
            (req.method === "GET" || req.method === "HEAD") && req.accepts(["json", "html"]) === "html";
        if (prefersHtml) {
            const dest = `/login.html?return=${encodeURIComponent(req.originalUrl || "/")}`;
            return res.redirect(302, dest);
        }

        return sendJsonError(
            res,
            401,
            "UNAUTHORIZED",
            "Authentication required",
            null,
            resolutionForManagementError("UNAUTHORIZED")
        );
    }
}
