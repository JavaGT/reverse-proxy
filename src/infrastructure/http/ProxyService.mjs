import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { createRequestLogger } from "../../shared/utils/Logger.mjs";

const HOP_BY_HOP_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
]);

const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * SRP: Orchestrates HTTP and WebSocket proxying with HA and Observability.
 * Encapsulated: Uses private class fields and methods.
 */
export class ProxyService {
    #registry;
    #buildExtraHeaders;
    #logger;

    constructor(registry, buildExtraHeaders, logger) {
        this.#registry = registry;
        this.#buildExtraHeaders = buildExtraHeaders;
        this.#logger = logger;
    }

    handleHttpRequest(req, res) {
        const startTime = Date.now();
        const requestId = req.headers["x-request-id"] || crypto.randomUUID();
        const log = createRequestLogger(requestId, {
            method: req.method,
            url: req.url,
            host: req.headers.host,
            clientIp: req.socket.remoteAddress
        });

        const host = req.headers.host?.split(":")[0];
        const route = host ? this.#registry.getRoute(host) : undefined;

        if (!route) {
            log.warn({ event: "proxy_route_not_found" }, `No route found for host: ${host}`);
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
            return;
        }

        // 🛡️ IP Allowlisting
        if (!this.#isIpAllowed(req, route.options?.allowlist)) {
            log.warn({ event: "proxy_access_denied" }, `Access denied for IP to host: ${host}`);
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Forbidden");
            return;
        }

        // ⚖️ Load Balancing
        const targetUrl = this.#registry.getTarget(host);
        if (!targetUrl) {
            log.error({ event: "proxy_no_healthy_targets" }, `No healthy targets available for: ${host}`);
            res.writeHead(503, { "Content-Type": "text/plain" });
            res.end("Service Unavailable");
            return;
        }

        const { hostname, port } = this.#parseTarget(targetUrl);
        const extraHeaders = { 
            ...this.#buildExtraHeaders(req),
            "x-request-id": requestId 
        };
        const headers = this.#buildUpstreamHeaders(req.headers, extraHeaders);

        let isUpstreamEnded = false;

        log.info({ event: "proxy_request_start", target: targetUrl }, `Proxying to ${targetUrl}`);

        const upstreamReq = http.request(
            { hostname, port, path: req.url, method: req.method, headers },
            (upstreamRes) => {
                res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
                upstreamRes.pipe(res);

                upstreamRes.on("error", (err) => {
                    log.error({ event: "proxy_upstream_response_error", error: err.message }, "Upstream response stream error");
                    res.destroy();
                });

                upstreamRes.on("end", () => {
                    isUpstreamEnded = true;
                    log.info({ 
                        event: "proxy_request_complete", 
                        status: upstreamRes.statusCode,
                        duration: Date.now() - startTime 
                    }, `Completed with ${upstreamRes.statusCode}`);
                });
            }
        );

        upstreamReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
            upstreamReq.destroy(new Error(`Upstream timed out after ${UPSTREAM_TIMEOUT_MS}ms`));
        });

        upstreamReq.on("error", (err) => {
            log.error({ event: "proxy_upstream_error", error: err.message }, "Upstream connection error");

            if (!res.headersSent) {
                res.writeHead(502, { "Content-Type": "text/plain" });
            }

            if (!res.writableEnded) {
                res.end("Bad gateway");
            }
        });

        req.on("close", () => {
            if (!isUpstreamEnded && !upstreamReq.writableEnded) {
                upstreamReq.destroy();
            }
        });

        req.pipe(upstreamReq);
    }

    handleWebSocketUpgrade(req, socket, head) {
        const requestId = req.headers["x-request-id"] || crypto.randomUUID();
        const log = createRequestLogger(requestId, {
            event: "websocket_upgrade",
            host: req.headers.host,
            clientIp: req.socket.remoteAddress
        });

        const host = req.headers.host?.split(":")[0];
        const route = host ? this.#registry.getRoute(host) : undefined;

        if (!route) {
            log.warn("No route found for WebSocket upgrade");
            socket.destroy();
            return;
        }

        if (!this.#isIpAllowed(req, route.options?.allowlist)) {
            log.warn("WebSocket access denied for IP");
            socket.destroy();
            return;
        }

        const targetUrl = this.#registry.getTarget(host);
        if (!targetUrl) {
            log.error("No healthy targets available for WebSocket");
            socket.destroy();
            return;
        }

        const { hostname, port } = this.#parseTarget(targetUrl);

        socket.on("error", (err) => {
            log.error({ error: err.message }, "WebSocket client socket error");
        });

        const conn = net.createConnection({ host: hostname, port });

        conn.once("connect", () => {
            log.info({ target: targetUrl }, `WebSocket tunnel established to ${targetUrl}`);
            conn.write(this.#buildRawUpgradeRequest(req));
            if (head && head.length > 0) {
                conn.write(head);
            }
            socket.pipe(conn);
            conn.pipe(socket);
        });

        conn.on("error", (err) => {
            log.error({ error: err.message }, "WebSocket upstream connection error");
            socket.destroy();
        });

        socket.on("close", () => {
            if (!conn.destroyed) conn.destroy();
        });

        conn.on("close", () => {
            if (!socket.destroyed) socket.destroy();
        });
    }

    createHttpsHandler() {
        return (req, res) => this.handleHttpRequest(req, res);
    }

    #isIpAllowed(req, allowlist) {
        if (!allowlist || !Array.isArray(allowlist) || allowlist.length === 0) {
            return true;
        }

        const clientIp = req.headers["x-forwarded-for"]?.split(",")[0].trim() 
                      || req.socket?.remoteAddress;

        if (!clientIp) return false;
        return allowlist.includes(clientIp);
    }

    #parseTarget(target) {
        const url = new URL(target);
        return {
            hostname: url.hostname,
            port: parseInt(url.port || "80", 10),
        };
    }

    #buildUpstreamHeaders(incomingHeaders, extra = {}) {
        const headers = {};
        for (const [key, val] of Object.entries(incomingHeaders)) {
            if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
                headers[key] = val;
            }
        }
        return { ...headers, ...extra };
    }

    #buildRawUpgradeRequest(req) {
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        for (const [key, val] of Object.entries(req.headers)) {
            if (Array.isArray(val)) {
                for (const v of val) lines.push(`${key}: ${v}`);
            } else {
                lines.push(`${key}: ${val}`);
            }
        }
        return lines.join("\r\n") + "\r\n\r\n";
    }
}
