import { buildDnsConsoleUrl, getDnsConsoleProvider } from "./DnsConsoleRegistry.mjs";

/**
 * @typedef {{ defaultProvider?: string | null, byApex?: Record<string, string | null> }} DnsConsoleConfig
 */

/**
 * @param {string[]} apexDomains
 * @param {DnsConsoleConfig | null | undefined} dnsConsole
 * @param {{ DNS_CONSOLE_DEFAULT_PROVIDER?: string }} [env]
 * @returns {{ apex: string, provider: string, label: string, url: string }[]}
 */
export function resolveDnsConsoleLinks(apexDomains, dnsConsole, env = process.env) {
    const out = [];
    const envDefault = env?.DNS_CONSOLE_DEFAULT_PROVIDER?.trim().toLowerCase() || null;
    const cfgDefault = dnsConsole?.defaultProvider != null ? String(dnsConsole.defaultProvider).trim().toLowerCase() : null;
    const byApex = dnsConsole?.byApex && typeof dnsConsole.byApex === "object" ? dnsConsole.byApex : {};

    for (const apex of apexDomains) {
        const a = String(apex).trim().toLowerCase();
        let providerId = byApex[a];
        if (providerId === undefined) {
            providerId = cfgDefault ?? envDefault;
        }
        if (providerId === null || providerId === "" || providerId === "none") continue;

        const p = getDnsConsoleProvider(providerId);
        if (!p) continue;

        const url = buildDnsConsoleUrl(providerId, a);
        if (!url) continue;

        out.push({
            apex: a,
            provider: p.id,
            label: p.label,
            url
        });
    }

    return out;
}

/**
 * @param {unknown} raw
 * @returns {DnsConsoleConfig | null}
 */
/**
 * @param {unknown} cfg
 * @throws {Error} if an unknown provider id is present
 */
export function assertValidDnsConsoleConfig(cfg) {
    if (cfg == null) return;
    if (typeof cfg !== "object" || Array.isArray(cfg)) {
        throw new Error("dnsConsole must be an object");
    }
    const o = /** @type {Record<string, unknown>} */ (cfg);
    if (o.defaultProvider != null && o.defaultProvider !== "") {
        const id = String(o.defaultProvider).trim().toLowerCase();
        if (!getDnsConsoleProvider(id)) {
            throw new Error(`Unknown DNS console provider: ${id}`);
        }
    }
    if (o.byApex != null && typeof o.byApex === "object" && !Array.isArray(o.byApex)) {
        for (const v of Object.values(o.byApex)) {
            if (v == null || v === "" || v === "none") continue;
            const id = String(v).trim().toLowerCase();
            if (!getDnsConsoleProvider(id)) {
                throw new Error(`Unknown DNS console provider: ${id}`);
            }
        }
    }
}

export function normalizeDnsConsoleInput(raw) {
    if (raw == null) return null;
    if (typeof raw !== "object" || Array.isArray(raw)) return null;

    const o = /** @type {Record<string, unknown>} */ (raw);
    const defaultProvider =
        o.defaultProvider === null || o.defaultProvider === ""
            ? null
            : o.defaultProvider != null
              ? String(o.defaultProvider).trim().toLowerCase()
              : undefined;

    let byApex = undefined;
    if (o.byApex != null && typeof o.byApex === "object" && !Array.isArray(o.byApex)) {
        byApex = {};
        for (const [k, v] of Object.entries(o.byApex)) {
            const key = String(k).trim().toLowerCase();
            if (!key) continue;
            if (v === null || v === "" || v === "none") {
                byApex[key] = null;
            } else {
                byApex[key] = String(v).trim().toLowerCase();
            }
        }
    }

    const cfg = {};
    if (defaultProvider !== undefined) cfg.defaultProvider = defaultProvider;
    if (byApex !== undefined) cfg.byApex = byApex;
    return Object.keys(cfg).length > 0 ? cfg : null;
}
