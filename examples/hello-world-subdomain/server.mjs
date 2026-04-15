import http from "node:http";
import { createHttpClient, ManagementApiError } from "@javagt/reverse-proxy-client";

/** Edit these to match your proxy (apex must exist in the proxy’s domain list). */
const listenHost = "127.0.0.1";
const port = 8765;
const subdomain = "hello";
const baseDomain = "example.com";

/** Management API (loopback; port from Settings → managementInterfacePort, default 24789). */
const baseUrl = "http://127.0.0.1:24789";

/** Path the proxy probes when `options.healthPath` is set on reserve (GET, expect 2xx). */
const HEALTH_PATH = "/health";

const client = createHttpClient({ baseUrl });

const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === HEALTH_PATH) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("OK\n");
        return;
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Hello from ${subdomain}.${baseDomain}\n`);
});

async function reserve() {
    return client.reserve({
        subdomain,
        baseDomain: String(baseDomain).trim().toLowerCase(),
        port,
        options: { healthPath: HEALTH_PATH }
    });
}

async function release() {
    return client.release(subdomain, String(baseDomain).trim().toLowerCase());
}

server.listen(port, listenHost, async () => {
    try {
        const result = await reserve();
        const data = result?.data ?? result;
        console.log("Registered with management API:", JSON.stringify(data, null, 2));
        console.log(
            `Listening on http://${listenHost}:${port} — public URL (when DNS/proxy match): https://${subdomain}.${baseDomain}/`
        );
    } catch (e) {
        if (e instanceof ManagementApiError) {
            console.error("Reserve failed:", e.status, e.code, e.message, e.details ?? "");
        } else {
            console.error(e);
        }
        server.close();
        process.exit(1);
    }
});

let shuttingDown = false;
async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
        await release();
        console.log(`Released ${subdomain}.${baseDomain}`);
    } catch (e) {
        if (e instanceof ManagementApiError) {
            console.error("Release failed:", e.status, e.code, e.message);
        } else {
            console.error(e);
        }
    }
    server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
