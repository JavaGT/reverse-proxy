/** HTTP helpers for the management UI (session cookie via credentials: include). */

/**
 * @param {unknown} body Parsed JSON body or text
 * @param {number} status HTTP status when body has no message
 */
export function messageFromErrorBody(body, status) {
    if (body == null) return `HTTP ${status}`;
    if (typeof body === "string") return body.slice(0, 500) || `HTTP ${status}`;
    if (typeof body !== "object") return String(body).slice(0, 500);
    const err = /** @type {{ message?: unknown; code?: unknown }} */ (body).error;
    if (typeof err === "string" && err.trim()) return err.trim().slice(0, 500);
    if (err && typeof err === "object" && typeof err.message === "string" && err.message.trim()) {
        const m = err.message.trim();
        const res =
            typeof /** @type {{ resolution?: string }} */ (err).resolution === "string" &&
            /** @type {{ resolution?: string }} */ (err).resolution?.trim()
                ? `${m} — ${/** @type {{ resolution?: string }} */ (err).resolution.trim()}`
                : m;
        return res.slice(0, 800);
    }
    try {
        return JSON.stringify(body).slice(0, 500);
    } catch {
        return `HTTP ${status}`;
    }
}

/**
 * Shared fetch: JSON Accept, optional JSON Content-Type when `body` is set.
 * @returns {Promise<{ res: Response; body: unknown }>}
 */
async function managementRequest(path, options = {}) {
    const headers = {
        Accept: "application/json",
        ...options.headers
    };
    if (options.body != null) {
        headers["Content-Type"] = "application/json";
    }

    const res = await fetch(path, {
        cache: "no-store",
        credentials: "include",
        ...options,
        headers
    });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await res.json() : await res.text();
    return { res, body };
}

/**
 * Same transport as {@link apiFetch} but returns status + parsed body (no throw on HTTP error).
 * Use when branching on status or `error.code` (e.g. fresh-auth flows).
 */
export async function apiFetchResult(path, options = {}) {
    return managementRequest(path, options);
}

export async function apiFetch(path, options = {}) {
    const { res, body } = await managementRequest(path, options);
    if (!res.ok) {
        throw new Error(messageFromErrorBody(body, res.status) || `HTTP ${res.status}`);
    }
    return body;
}
