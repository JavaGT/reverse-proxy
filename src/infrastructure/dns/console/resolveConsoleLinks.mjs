import { buildDnsConsoleUrl, getDnsConsoleProvider } from "./DnsConsoleRegistry.mjs";

/**
 * @typedef {{ defaultProvider?: string | null, byApex?: Record<string, string | null> }} DnsConsoleConfig
 */

/**
 * Single precedence chain for DNS console: `byApex[apex]` → `defaultProvider` → `env.DNS_CONSOLE_DEFAULT_PROVIDER`.
 *
 * - **explicit_none** — per-apex override excludes this apex (`none` / empty).
 * - **unset** — no provider configured for this apex (inherit chain empty); links skip; DDNS apex mode treats as legacy eligible.
 * - **resolved** — effective provider id (may be unknown to the registry).
 *
 * @param {string} apex - Apex FQDN (normalized inside)
 * @param {DnsConsoleConfig | null | undefined} dnsConsole
 * @param {{ DNS_CONSOLE_DEFAULT_PROVIDER?: string } | undefined} [env]
 * @returns {{ kind: "explicit_none" } | { kind: "unset" } | { kind: "resolved", id: string }}
 */
export function resolveDnsConsoleProviderForApex(apex, dnsConsole, env = process.env) {
    const a = String(apex ?? "")
        .trim()
        .toLowerCase();
    if (!a) {
        return { kind: "unset" };
    }

    const byApex = dnsConsole?.byApex && typeof dnsConsole.byApex === "object" ? dnsConsole.byApex : {};
    const cfgDefault =
        dnsConsole?.defaultProvider != null ? String(dnsConsole.defaultProvider).trim().toLowerCase() : null;
    const envDefault = env?.DNS_CONSOLE_DEFAULT_PROVIDER?.trim().toLowerCase() || null;

    if (Object.prototype.hasOwnProperty.call(byApex, a)) {
        const v = byApex[a];
        if (v === null || v === "" || String(v).trim().toLowerCase() === "none") {
            return { kind: "explicit_none" };
        }
        return { kind: "resolved", id: String(v).trim().toLowerCase() };
    }

    const merged = cfgDefault ?? envDefault;
    if (merged == null || merged === "" || String(merged).trim().toLowerCase() === "none") {
        return { kind: "unset" };
    }
    return { kind: "resolved", id: String(merged).trim().toLowerCase() };
}

/**
 * Whether DDNS for a given registrar `dnsRegistrarId` (e.g. `porkbun`, `namecheap`) should include this apex
 * when using "all apex" mode. Uses {@link resolveDnsConsoleProviderForApex}.
 *
 * @param {string} dnsRegistrarId - e.g. `porkbun`, `namecheap`
 * @param {string} apex
 * @param {DnsConsoleConfig | null | undefined} dnsConsole
 * @param {{ DNS_CONSOLE_DEFAULT_PROVIDER?: string } | undefined} [env]
 */
export function apexEligibleForDnsRegistrarId(dnsRegistrarId, apex, dnsConsole, env = process.env) {
    const want = String(dnsRegistrarId ?? "")
        .trim()
        .toLowerCase();
    if (!want) return false;

    const a = String(apex).trim().toLowerCase();
    if (!a) return false;

    const r = resolveDnsConsoleProviderForApex(a, dnsConsole, env);
    if (r.kind === "explicit_none") return false;
    if (r.kind === "unset") return true;

    const id = r.id;
    const p = getDnsConsoleProvider(id);
    if (!p) return true;
    return id === want;
}

/**
 * Whether Porkbun DDNS should touch this apex when using "all apex" mode.
 *
 * @param {string} apex
 * @param {DnsConsoleConfig | null | undefined} dnsConsole
 * @param {{ DNS_CONSOLE_DEFAULT_PROVIDER?: string } | undefined} [env]
 */
export function apexEligibleForPorkbunDdns(apex, dnsConsole, env = process.env) {
    return apexEligibleForDnsRegistrarId("porkbun", apex, dnsConsole, env);
}

/**
 * @param {string} ddnsProviderId - Same ids as DDNS job `provider` (`porkbun`, `namecheap`, …)
 * @param {string} apex
 * @param {DnsConsoleConfig | null | undefined} dnsConsole
 * @param {{ DNS_CONSOLE_DEFAULT_PROVIDER?: string } | undefined} [env]
 */
export function apexEligibleForDdnsProvider(ddnsProviderId, apex, dnsConsole, env = process.env) {
    const id = String(ddnsProviderId ?? "")
        .trim()
        .toLowerCase();
    if (id === "porkbun" || id === "namecheap") {
        return apexEligibleForDnsRegistrarId(id, apex, dnsConsole, env);
    }
    return false;
}

/**
 * @param {string[]} apexDomains
 * @param {DnsConsoleConfig | null | undefined} dnsConsole
 * @param {{ DNS_CONSOLE_DEFAULT_PROVIDER?: string }} [env]
 * @returns {{ apex: string, provider: string, label: string, url: string }[]}
 */
export function resolveDnsConsoleLinks(apexDomains, dnsConsole, env = process.env) {
    const out = [];

    for (const apex of apexDomains) {
        const a = String(apex).trim().toLowerCase();
        const r = resolveDnsConsoleProviderForApex(a, dnsConsole, env);
        if (r.kind === "explicit_none" || r.kind === "unset") continue;

        const p = getDnsConsoleProvider(r.id);
        if (!p) continue;

        const url = buildDnsConsoleUrl(r.id, a);
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
