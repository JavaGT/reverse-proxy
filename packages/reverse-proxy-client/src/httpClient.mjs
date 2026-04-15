import { getFetch } from "./fetch.mjs";
import { ManagementApiError } from "./errors.mjs";

/**
 * @param {{ baseUrl: string, token?: string | null, fetch?: typeof fetch }} options
 */
export function createHttpClient(options) {
    const base = String(options.baseUrl).replace(/\/$/, "");
    const fetchFn = options.fetch ?? getFetch();
    const token = options.token != null && String(options.token).trim() !== "" ? String(options.token).trim() : null;

    /** @param {string} path */
    async function request(path, init = {}) {
        const headers = {
            Accept: "application/json",
            ...init.headers
        };
        if (init.body != null && !headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
        }
        if (token) {
            headers.Authorization = `Bearer ${token}`;
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
            const err = json?.error;
            throw new ManagementApiError(
                res.status,
                err?.code ?? "HTTP_ERROR",
                err?.message ?? res.statusText ?? "Request failed",
                err?.details ?? null,
                err?.resolution ?? null
            );
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
        deleteDdns: () => request("/api/v1/ddns", { method: "DELETE" })
    };
}
