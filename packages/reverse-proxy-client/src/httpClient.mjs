import { getFetch } from "./fetch.mjs";
import { ManagementApiError } from "./errors.mjs";

/**
 * @param {unknown} json
 */
function parseManagementError(json) {
    const err = json?.error;
    if (typeof err === "string") {
        return {
            code: "HTTP_ERROR",
            message: err,
            details: null,
            resolution: null
        };
    }
    if (err && typeof err === "object") {
        return {
            code: typeof err.code === "string" ? err.code : "HTTP_ERROR",
            message: typeof err.message === "string" ? err.message : "Request failed",
            details: err.details ?? null,
            resolution: typeof err.resolution === "string" ? err.resolution : null
        };
    }
    return {
        code: "HTTP_ERROR",
        message: "Request failed",
        details: null,
        resolution: null
    };
}

/**
 * @param {{ baseUrl: string, fetch?: typeof fetch }} options
 */
export function createHttpClient(options) {
    const base = String(options.baseUrl).replace(/\/$/, "");
    const fetchFn = options.fetch ?? getFetch();

    /** @param {string} path */
    async function request(path, init = {}) {
        const headers = {
            Accept: "application/json",
            ...init.headers
        };
        if (init.body != null && !headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
        }
        const res = await fetchFn(`${base}${path}`, { ...init, headers });
        const text = await res.text();
        let json = null;
        if (text) {
            try {
                json = JSON.parse(text);
            } catch {
                json = null;
            }
        }
        if (!res.ok) {
            const { code, message, details, resolution } = parseManagementError(json);
            throw new ManagementApiError(res.status, code, message, details, resolution);
        }
        return json;
    }

    return {
        health: () => request("/api/v1/health"),
        status: () => request("/api/v1/status"),
        getDomains: () => request("/api/v1/domains"),
        getRoutes: () => request("/api/v1/routes"),
        getNetwork: () => request("/api/v1/network"),
        /** @param {{ start?: number, end?: number, concurrency?: number }} [body] */
        scanPorts: body => request("/api/v1/scan", { method: "POST", body: JSON.stringify(body ?? {}) }),
        /** @param {number | string} port */
        killProcess: port => request(`/api/v1/process/${encodeURIComponent(String(port))}`, { method: "DELETE" }),
        /** @param {Record<string, unknown>} body */
        reserve: body => request("/api/v1/reserve", { method: "POST", body: JSON.stringify(body) }),
        /**
         * @param {string} subdomain
         * @param {string} baseDomain
         */
        release: (subdomain, baseDomain) => {
            const q = new URLSearchParams({ baseDomain: String(baseDomain) });
            return request(`/api/v1/reserve/${encodeURIComponent(subdomain)}?${q}`, { method: "DELETE" });
        },
        /** @param {Record<string, unknown>} body */
        putDomains: body => request("/api/v1/domains", { method: "PUT", body: JSON.stringify(body) }),
        getDdns: () => request("/api/v1/ddns"),
        /** @param {Record<string, unknown>} body */
        putDdns: body => request("/api/v1/ddns", { method: "PUT", body: JSON.stringify(body) }),
        deleteDdns: () => request("/api/v1/ddns", { method: "DELETE" }),
        postDdnsSync: () => request("/api/v1/ddns/sync", { method: "POST" })
    };
}
