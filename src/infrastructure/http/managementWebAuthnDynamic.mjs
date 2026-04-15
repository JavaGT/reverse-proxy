import { isLoopbackAddr } from "is-loopback-addr";

/** @typedef {{ rpID: string, origin: string, domain: string }} WebAuthnRequestContext */

/**
 * Host part only (no port), lowercased. Supports bracketed IPv6 (`[::1]:port`) and `hostname:port`.
 * @param {string | undefined} hostHeader
 */
export function managementHostOnly(hostHeader) {
    if (hostHeader == null || typeof hostHeader !== "string") return "";
    const t = hostHeader.trim();
    if (t.startsWith("[")) {
        const end = t.indexOf("]");
        if (end > 1) return t.slice(1, end).toLowerCase();
        return "";
    }
    const colon = t.lastIndexOf(":");
    if (colon > 0 && t.indexOf(":") === colon && /^\d+$/.test(t.slice(colon + 1))) {
        return t.slice(0, colon).toLowerCase();
    }
    return t.toLowerCase();
}

/**
 * WebAuthn `rpID` / `origin` for the current browser request (Host + optional X-Forwarded-Proto).
 * Loopback hosts use rpID `localhost` (WebAuthn dev exception). Public hostnames use the full hostname as rpID.
 *
 * Used with `@javagt/express-easy-auth` v2+ `setupAuth({ getWebAuthnOptions })`.
 *
 * @param {import("express").Request} req
 * @param {{ rpID: string, origin: string, domain: string }} fallback From env when Host is missing or host is a non-loopback IP literal
 * @returns {WebAuthnRequestContext}
 */
export function deriveManagementWebAuthnContext(req, fallback) {
    const hostHeader = req.get("host")?.trim() || "";
    const host = managementHostOnly(hostHeader);

    const xfProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    let protocol = "http";
    if (xfProto === "https" || xfProto === "http") protocol = xfProto;
    else if (req.secure) protocol = "https";
    else if (typeof req.protocol === "string") {
        const p = req.protocol.replace(/:$/, "");
        if (p === "https" || p === "http") protocol = p;
    }

    const origin = hostHeader ? `${protocol}://${hostHeader}` : fallback.origin;

    if (!host || host === "localhost" || isLoopbackAddr(host)) {
        return { rpID: "localhost", origin, domain: "localhost" };
    }

    // WebAuthn rpID cannot be an arbitrary IP (non-loopback). Keep env-based registration domain.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        return { rpID: fallback.rpID, origin, domain: fallback.domain };
    }

    return { rpID: host, origin, domain: host };
}

/**
 * @param {{ rpID: string, origin: string, domain: string }} fallback
 * @param {string} [rpName]
 * @returns {(req: import("express").Request) => { rpID: string, origin: string, rpName: string }}
 */
export function createManagementGetWebAuthnOptions(fallback, rpName = "Reverse proxy management") {
    return req => {
        const o = deriveManagementWebAuthnContext(req, fallback);
        return { rpID: o.rpID, origin: o.origin, rpName };
    };
}
