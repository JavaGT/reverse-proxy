/** @typedef {"none" | "sqlite"} DdnsConfigSource */
/** @typedef {"NONE" | "STORED_EXPLICIT" | "STORED_APEX"} DdnsDomainListSource */

export const DEFAULT_IPV4_SERVICES = Object.freeze([
    "https://api4.ipify.org",
    "https://ipv4.icanhazip.com",
    "https://v4.ident.me",
    "https://ifconfig.me/ip"
]);

const DEFAULT_IPV6_SERVICES = Object.freeze([
    "https://api6.ipify.org",
    "https://ipv6.icanhazip.com",
    "https://v6.ident.me",
    "https://ifconfig.me/ip"
]);

export const DEFAULT_PORKBUN_API_BASE_URL = "https://api.porkbun.com/api/json/v3";

const INTERVAL_MIN_MS = 10_000;
const INTERVAL_MAX_MS = 86_400_000;
const NOTE_MIN = 1;
const NOTE_MAX = 512;
const LOOKUP_MIN_MS = 1000;
const LOOKUP_MAX_MS = 120_000;
const MAX_SERVICE_URLS = 20;
const MAX_SERVICE_URL_LEN = 512;
const MAX_API_BASE_LEN = 256;

/**
 * @param {string} s
 * @returns {boolean}
 */
function isAllowedServiceUrl(s) {
    const t = String(s).trim();
    if (!t || t.length > MAX_SERVICE_URL_LEN) return false;
    try {
        const u = new URL(t);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * @param {unknown} raw
 * @param {string} fieldLabel
 * @param {readonly string[]} defaultList
 * @returns {{ ok: true, value: string[] } | { ok: false, message: string }}
 */
function parseUrlServiceList(raw, fieldLabel, defaultList) {
    if (raw === undefined || raw === null) {
        return { ok: true, value: [...defaultList] };
    }
    let list = [];
    if (Array.isArray(raw)) {
        list = raw.map(x => String(x).trim()).filter(Boolean);
    } else if (typeof raw === "string") {
        list = raw
            .split(/[\r\n]+/)
            .map(x => x.trim())
            .filter(Boolean);
    } else {
        return { ok: false, message: `${fieldLabel} must be an array of URLs or a newline-separated string` };
    }
    if (list.length === 0 || list.length > MAX_SERVICE_URLS) {
        return { ok: false, message: `${fieldLabel} must have 1–${MAX_SERVICE_URLS} URLs` };
    }
    for (const u of list) {
        if (!isAllowedServiceUrl(u)) {
            return { ok: false, message: `${fieldLabel} contains invalid URL: ${u}` };
        }
    }
    return { ok: true, value: list };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string[] } | { ok: false, message: string }}
 */
function parseIpv4ServicesField(raw) {
    return parseUrlServiceList(raw, "ipv4Services", DEFAULT_IPV4_SERVICES);
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string[] } | { ok: false, message: string }}
 */
function parseIpv6ServicesField(raw) {
    return parseUrlServiceList(raw, "ipv6Services", DEFAULT_IPV6_SERVICES);
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string } | { ok: false, message: string }}
 */
function parsePorkbunApiBaseUrlField(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
        return { ok: true, value: DEFAULT_PORKBUN_API_BASE_URL };
    }
    const t = String(raw).trim();
    if (t.length > MAX_API_BASE_LEN) {
        return { ok: false, message: "porkbunApiBaseUrl is too long" };
    }
    try {
        const u = new URL(t);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
            return { ok: false, message: "porkbunApiBaseUrl must use http or https" };
        }
        return { ok: true, value: t.replace(/\/+$/, "") };
    } catch {
        return { ok: false, message: "porkbunApiBaseUrl must be a valid URL" };
    }
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: object } | { ok: false, message: string }}
 */
export function parseStoredDdnsRow(raw) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, message: "Invalid stored DDNS payload" };
    }
    const enabled = Boolean(raw.enabled);
    const porkbunApiKey = String(raw.porkbunApiKey ?? "").trim();
    const porkbunSecretKey = String(raw.porkbunSecretKey ?? "").trim();
    const domainMode = raw.domainMode === "explicit" ? "explicit" : "apex";
    const domains = Array.isArray(raw.domains)
        ? raw.domains.map(d => String(d).trim().toLowerCase()).filter(Boolean)
        : [];
    const matchNote = String(raw.matchNote ?? "").trim();
    const intervalMs = clampInt(raw.intervalMs, INTERVAL_MIN_MS, INTERVAL_MAX_MS, 300_000);
    const ipLookupTimeoutMs = clampInt(raw.ipLookupTimeoutMs, LOOKUP_MIN_MS, LOOKUP_MAX_MS, 8000);

    const v4 = parseIpv4ServicesField(raw.ipv4Services);
    if (!v4.ok) return v4;
    const v6 = parseIpv6ServicesField(raw.ipv6Services);
    if (!v6.ok) return v6;
    const base = parsePorkbunApiBaseUrlField(raw.porkbunApiBaseUrl);
    if (!base.ok) return base;

    if (matchNote.length < NOTE_MIN || matchNote.length > NOTE_MAX) {
        return { ok: false, message: `matchNote must be between ${NOTE_MIN} and ${NOTE_MAX} characters` };
    }
    if (domainMode === "explicit" && domains.length === 0) {
        return { ok: false, message: "domainMode explicit requires at least one domain" };
    }

    return {
        ok: true,
        value: {
            enabled,
            porkbunApiKey,
            porkbunSecretKey,
            domainMode,
            domains,
            matchNote,
            intervalMs,
            ipLookupTimeoutMs,
            ipv4Services: v4.value,
            ipv6Services: v6.value,
            porkbunApiBaseUrl: base.value
        }
    };
}

/**
 * @param {object} stored - validated stored row
 * @param {() => string[] | undefined} getApexDomains
 * @returns {{ domains: string[], domainListSource: DdnsDomainListSource }}
 */
function resolveDomainsForStored(stored, getApexDomains) {
    if (stored.domainMode === "apex") {
        const list = (typeof getApexDomains === "function" ? getApexDomains() : []) ?? [];
        return { domains: [...list], domainListSource: "STORED_APEX" };
    }
    return { domains: [...stored.domains], domainListSource: "STORED_EXPLICIT" };
}

function unconfiguredSummary() {
    return {
        provider: "porkbun",
        configSource: "none",
        configInvalid: false,
        configInvalidMessage: null,
        enabled: false,
        credentialsConfigured: false,
        domains: [],
        domainListSource: "NONE",
        domainMode: null,
        matchNote: "match:reverse-proxy-ddns",
        intervalMs: 300_000,
        ipLookupTimeoutMs: 8000,
        ipv4Services: [...DEFAULT_IPV4_SERVICES],
        ipv6Services: [...DEFAULT_IPV6_SERVICES],
        porkbunApiBaseUrl: DEFAULT_PORKBUN_API_BASE_URL,
        schedulerWouldRun: false,
        schedulerState: "not_configured"
    };
}

/**
 * Public API + scheduler summary (no raw secrets).
 * @param {{ getApexDomains: () => string[] | undefined, stored: object | null }} ctx
 */
export function buildDdnsPublicSummary(ctx) {
    const { getApexDomains, stored } = ctx;

    if (stored) {
        const parsed = parseStoredDdnsRow(stored);
        if (!parsed.ok) {
            return {
                provider: "porkbun",
                configSource: "sqlite",
                configInvalid: true,
                configInvalidMessage: parsed.message,
                domainMode: null,
                enabled: false,
                credentialsConfigured: false,
                domains: [],
                domainListSource: "NONE",
                matchNote: "match:reverse-proxy-ddns",
                intervalMs: 300_000,
                ipLookupTimeoutMs: 8000,
                ipv4Services: [...DEFAULT_IPV4_SERVICES],
                ipv6Services: [...DEFAULT_IPV6_SERVICES],
                porkbunApiBaseUrl: DEFAULT_PORKBUN_API_BASE_URL,
                schedulerWouldRun: false,
                schedulerState: "disabled"
            };
        }

        const s = parsed.value;
        const { domains, domainListSource } = resolveDomainsForStored(s, getApexDomains);
        const credentialsConfigured = !!(s.porkbunApiKey && s.porkbunSecretKey);
        const schedulerWouldRun = s.enabled && credentialsConfigured && domains.length > 0;
        let schedulerState = "disabled";
        if (!s.enabled) schedulerState = "disabled";
        else if (!credentialsConfigured) schedulerState = "missing_credentials";
        else if (domains.length === 0) schedulerState = "no_domains";
        else schedulerState = "running";

        return {
            provider: "porkbun",
            configSource: "sqlite",
            configInvalid: false,
            configInvalidMessage: null,
            enabled: s.enabled,
            credentialsConfigured,
            domains,
            domainListSource,
            domainMode: s.domainMode,
            matchNote: s.matchNote,
            intervalMs: s.intervalMs,
            ipLookupTimeoutMs: s.ipLookupTimeoutMs,
            ipv4Services: [...s.ipv4Services],
            ipv6Services: [...s.ipv6Services],
            porkbunApiBaseUrl: s.porkbunApiBaseUrl,
            schedulerWouldRun,
            schedulerState
        };
    }

    return unconfiguredSummary();
}

/**
 * @param {{ persistence: { getDdnsSettings?: () => object | null }, getApexDomains: () => string[] | undefined }} ctx
 */
export function getRuntimeDdnsTick(ctx) {
    const { persistence, getApexDomains } = ctx;
    const storedRaw = typeof persistence.getDdnsSettings === "function" ? persistence.getDdnsSettings() : null;

    if (!storedRaw) {
        return {
            shouldRun: false,
            nextDelayMs: 60_000,
            logReason: "ddns_not_configured",
            logMessage: "No DDNS settings in SQLite; configure via PUT /api/v1/ddns or the management UI"
        };
    }

    const parsed = parseStoredDdnsRow(storedRaw);
    if (!parsed.ok) {
        return {
            shouldRun: false,
            nextDelayMs: 60_000,
            logReason: "invalid_stored_ddns",
            logMessage: parsed.message
        };
    }
    const s = parsed.value;
    const { domains } = resolveDomainsForStored(s, getApexDomains);
    const hasKeys = !!(s.porkbunApiKey && s.porkbunSecretKey);
    const shouldRun = s.enabled && hasKeys && domains.length > 0;
    return {
        shouldRun,
        nextDelayMs: shouldRun ? clampDelay(s.intervalMs) : 60_000,
        domains,
        matchNote: s.matchNote,
        apiKey: s.porkbunApiKey,
        secretKey: s.porkbunSecretKey,
        ipLookupTimeoutMs: s.ipLookupTimeoutMs,
        ipv4Services: s.ipv4Services,
        ipv6Services: s.ipv6Services,
        porkbunApiBaseUrl: s.porkbunApiBaseUrl,
        logReason: shouldRun ? null : !s.enabled ? "ddns_disabled" : !hasKeys ? "ddns_no_keys" : "ddns_no_domain_list"
    };
}

function clampDelay(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return 300_000;
    return Math.max(INTERVAL_MIN_MS, Math.min(n, INTERVAL_MAX_MS));
}

function clampInt(raw, lo, hi, fallback) {
    const n = parseInt(String(raw ?? "").trim(), 10);
    if (!Number.isInteger(n)) return fallback;
    return Math.max(lo, Math.min(n, hi));
}

/**
 * @param {object | null} prev
 * @param {object} body
 * @param {(s: string) => boolean} isValidApexFQDN
 * @returns {{ ok: true, value: object } | { ok: false, message: string }}
 */
export function mergePutDdnsBody(prev, body, isValidApexFQDN) {
    if (!body || typeof body !== "object") {
        return { ok: false, message: "Body must be a JSON object" };
    }

    const enabled =
        body.enabled === undefined && prev ? Boolean(prev.enabled) : Boolean(body.enabled);

    let porkbunApiKey = body.porkbunApiKey != null ? String(body.porkbunApiKey).trim() : "";
    let porkbunSecretKey = body.porkbunSecretKey != null ? String(body.porkbunSecretKey).trim() : "";
    if (prev) {
        if (!porkbunApiKey) porkbunApiKey = String(prev.porkbunApiKey ?? "").trim();
        if (!porkbunSecretKey) porkbunSecretKey = String(prev.porkbunSecretKey ?? "").trim();
    }

    const dm = body.domainMode;
    const domainMode =
        dm === "explicit"
            ? "explicit"
            : dm === "apex"
              ? "apex"
              : prev?.domainMode === "explicit"
                ? "explicit"
                : "apex";
    let domains = [];
    if (Array.isArray(body.domains)) {
        domains = body.domains.map(d => String(d).trim().toLowerCase()).filter(Boolean);
    } else if (typeof body.domains === "string") {
        domains = body.domains
            .split(/[\s,]+/)
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
    }
    if (domainMode === "explicit" && domains.length === 0 && prev?.domainMode === "explicit" && Array.isArray(prev.domains)) {
        domains = prev.domains.map(d => String(d).trim().toLowerCase()).filter(Boolean);
    }

    for (const d of domains) {
        if (!isValidApexFQDN(d)) {
            return { ok: false, message: `Invalid apex domain: ${d}` };
        }
    }

    const matchNoteRaw = body.matchNote != null ? String(body.matchNote).trim() : "";
    const matchNote =
        matchNoteRaw.length > 0 ? matchNoteRaw : prev ? String(prev.matchNote ?? "").trim() : "match:reverse-proxy-ddns";
    if (matchNote.length < NOTE_MIN || matchNote.length > NOTE_MAX) {
        return { ok: false, message: `matchNote must be between ${NOTE_MIN} and ${NOTE_MAX} characters` };
    }

    const intervalMs = clampInt(body.intervalMs, INTERVAL_MIN_MS, INTERVAL_MAX_MS, prev?.intervalMs ?? 300_000);
    const ipLookupTimeoutMs = clampInt(
        body.ipLookupTimeoutMs,
        LOOKUP_MIN_MS,
        LOOKUP_MAX_MS,
        prev?.ipLookupTimeoutMs ?? 8000
    );

    const ipv4Source =
        body.ipv4Services !== undefined && body.ipv4Services !== null ? body.ipv4Services : prev?.ipv4Services;
    const v4 = parseIpv4ServicesField(ipv4Source);
    if (!v4.ok) return v4;

    const ipv6Source =
        body.ipv6Services !== undefined && body.ipv6Services !== null ? body.ipv6Services : prev?.ipv6Services;
    const v6 = parseIpv6ServicesField(ipv6Source);
    if (!v6.ok) return v6;

    const baseSource =
        body.porkbunApiBaseUrl !== undefined && body.porkbunApiBaseUrl !== null
            ? body.porkbunApiBaseUrl
            : prev?.porkbunApiBaseUrl;
    const base = parsePorkbunApiBaseUrlField(baseSource);
    if (!base.ok) return base;

    if (domainMode === "explicit" && domains.length === 0) {
        return { ok: false, message: "domainMode explicit requires a non-empty domains list" };
    }

    if (!porkbunApiKey || !porkbunSecretKey) {
        return { ok: false, message: "porkbunApiKey and porkbunSecretKey are required (send both, or omit to keep stored keys)" };
    }

    return {
        ok: true,
        value: {
            enabled,
            porkbunApiKey,
            porkbunSecretKey,
            domainMode,
            domains: domainMode === "explicit" ? domains : [],
            matchNote,
            intervalMs,
            ipLookupTimeoutMs,
            ipv4Services: v4.value,
            ipv6Services: v6.value,
            porkbunApiBaseUrl: base.value
        }
    };
}
