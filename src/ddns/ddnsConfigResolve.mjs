import { apexEligibleForDdnsProvider } from "../infrastructure/dns/console/resolveConsoleLinks.mjs";
import { DDNS_SCHEMA_VERSION, LEGACY_V1_JOB_ID, isValidDdnsJobId } from "./ddnsDocument.mjs";

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

/** @param {object} v - validated v1 flat row from {@link parseStoredDdnsRow} */
function v1RowToV2Document(v) {
    return {
        version: DDNS_SCHEMA_VERSION,
        jobs: [
            {
                id: LEGACY_V1_JOB_ID,
                provider: "porkbun",
                enabled: v.enabled,
                credentials: {
                    porkbunApiKey: v.porkbunApiKey,
                    porkbunSecretKey: v.porkbunSecretKey,
                    porkbunApiBaseUrl: v.porkbunApiBaseUrl
                },
                domainMode: v.domainMode,
                domains: [...v.domains],
                matchNote: v.matchNote,
                intervalMs: v.intervalMs,
                ipLookupTimeoutMs: v.ipLookupTimeoutMs,
                ipv4Services: [...v.ipv4Services],
                ipv6Services: [...v.ipv6Services]
            }
        ]
    };
}

/**
 * @param {object} job
 * @returns {object | null}
 */
function porkbunJobToV1Flat(job) {
    if (!job || job.provider !== "porkbun") return null;
    const c = job.credentials && typeof job.credentials === "object" ? job.credentials : {};
    return {
        enabled: Boolean(job.enabled),
        porkbunApiKey: String(c.porkbunApiKey ?? "").trim(),
        porkbunSecretKey: String(c.porkbunSecretKey ?? "").trim(),
        domainMode: job.domainMode === "explicit" ? "explicit" : "apex",
        domains: Array.isArray(job.domains) ? [...job.domains] : [],
        matchNote: String(job.matchNote ?? "").trim(),
        intervalMs: job.intervalMs,
        ipLookupTimeoutMs: job.ipLookupTimeoutMs,
        ipv4Services: job.ipv4Services,
        ipv6Services: job.ipv6Services,
        porkbunApiBaseUrl: c.porkbunApiBaseUrl
    };
}

/**
 * @param {object} flat
 * @param {string} id
 * @returns {object}
 */
function v1FlatToPorkbunJob(flat, id) {
    return {
        id,
        provider: "porkbun",
        enabled: flat.enabled,
        credentials: {
            porkbunApiKey: flat.porkbunApiKey,
            porkbunSecretKey: flat.porkbunSecretKey,
            porkbunApiBaseUrl: flat.porkbunApiBaseUrl
        },
        domainMode: flat.domainMode,
        domains: flat.domainMode === "explicit" ? [...flat.domains] : [],
        matchNote: flat.matchNote,
        intervalMs: flat.intervalMs,
        ipLookupTimeoutMs: flat.ipLookupTimeoutMs,
        ipv4Services: [...flat.ipv4Services],
        ipv6Services: [...flat.ipv6Services]
    };
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: { version: number, jobs: object[] } } | { ok: false, message: string }}
 */
export function normalizeStoredDdns(raw) {
    if (raw == null) {
        return { ok: false, message: "No DDNS configuration" };
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, message: "Invalid stored DDNS payload" };
    }
    const o = /** @type {Record<string, unknown>} */ (raw);
    if (o.version === DDNS_SCHEMA_VERSION && Array.isArray(o.jobs)) {
        return parseAndNormalizeV2Document(o);
    }
    const v1 = parseStoredDdnsRow(raw);
    if (!v1.ok) return v1;
    return { ok: true, value: v1RowToV2Document(v1.value) };
}

/**
 * @param {Record<string, unknown>} doc
 */
function parseAndNormalizeV2Document(doc) {
    const jobsIn = doc.jobs;
    if (!Array.isArray(jobsIn) || jobsIn.length === 0) {
        return { ok: false, message: "DDNS jobs array must be non-empty" };
    }
    if (jobsIn.length > 32) {
        return { ok: false, message: "Too many DDNS jobs (max 32)" };
    }
    const seen = new Set();
    const jobs = [];
    for (let i = 0; i < jobsIn.length; i++) {
        const parsed = parseDdnsJobRow(jobsIn[i], i);
        if (!parsed.ok) return parsed;
        const id = parsed.value.id;
        if (seen.has(id)) {
            return { ok: false, message: `Duplicate DDNS job id: ${id}` };
        }
        seen.add(id);
        jobs.push(parsed.value);
    }
    return { ok: true, value: { version: DDNS_SCHEMA_VERSION, jobs } };
}

/**
 * @param {unknown} raw
 * @param {number} index
 */
function parseDdnsJobRow(raw, index) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, message: `jobs[${index}] must be an object` };
    }
    const o = /** @type {Record<string, unknown>} */ (raw);
    const idRaw = o.id != null ? String(o.id).trim() : "";
    if (!isValidDdnsJobId(idRaw)) {
        return { ok: false, message: `jobs[${index}]: invalid id` };
    }
    const provider = String(o.provider ?? "")
        .trim()
        .toLowerCase();
    if (provider !== "porkbun" && provider !== "namecheap") {
        return { ok: false, message: `jobs[${index}]: unsupported provider "${provider}"` };
    }
    const enabled = Boolean(o.enabled);
    const domainMode = o.domainMode === "explicit" ? "explicit" : "apex";
    const domains = Array.isArray(o.domains)
        ? o.domains.map(d => String(d).trim().toLowerCase()).filter(Boolean)
        : [];
    const matchNote = String(o.matchNote ?? "").trim();
    const intervalMs = clampInt(o.intervalMs, INTERVAL_MIN_MS, INTERVAL_MAX_MS, 300_000);
    const ipLookupTimeoutMs = clampInt(o.ipLookupTimeoutMs, LOOKUP_MIN_MS, LOOKUP_MAX_MS, 8000);

    const v4 = parseIpv4ServicesField(o.ipv4Services);
    if (!v4.ok) return { ok: false, message: `jobs[${index}]: ${v4.message}` };
    const v6 = parseIpv6ServicesField(o.ipv6Services);
    if (!v6.ok) return { ok: false, message: `jobs[${index}]: ${v6.message}` };

    if (matchNote.length < NOTE_MIN || matchNote.length > NOTE_MAX) {
        return {
            ok: false,
            message: `jobs[${index}]: matchNote must be between ${NOTE_MIN} and ${NOTE_MAX} characters`
        };
    }
    if (domainMode === "explicit" && domains.length === 0) {
        return { ok: false, message: `jobs[${index}]: domainMode explicit requires at least one domain` };
    }

    if (provider === "porkbun") {
        const cred = o.credentials != null && typeof o.credentials === "object" && !Array.isArray(o.credentials) ? o.credentials : {};
        const cr = /** @type {Record<string, unknown>} */ (cred);
        const porkbunApiKey = String(cr.porkbunApiKey ?? "").trim();
        const porkbunSecretKey = String(cr.porkbunSecretKey ?? "").trim();
        const base = parsePorkbunApiBaseUrlField(cr.porkbunApiBaseUrl);
        if (!base.ok) return { ok: false, message: `jobs[${index}]: ${base.message}` };
        return {
            ok: true,
            value: {
                id: idRaw,
                provider: "porkbun",
                enabled,
                credentials: {
                    porkbunApiKey,
                    porkbunSecretKey,
                    porkbunApiBaseUrl: base.value
                },
                domainMode,
                domains: domainMode === "explicit" ? domains : [],
                matchNote,
                intervalMs,
                ipLookupTimeoutMs,
                ipv4Services: v4.value,
                ipv6Services: v6.value
            }
        };
    }

    const cred = o.credentials != null && typeof o.credentials === "object" && !Array.isArray(o.credentials) ? o.credentials : {};
    const cr = /** @type {Record<string, unknown>} */ (cred);
    const apiUser = String(cr.apiUser ?? "").trim();
    const apiKey = String(cr.apiKey ?? "").trim();
    const clientIp = String(cr.clientIp ?? "").trim();
    const sandbox = Boolean(cr.sandbox);
    let syncRecordNames = ["@"];
    if (Array.isArray(cr.syncRecordNames) && cr.syncRecordNames.length > 0) {
        syncRecordNames = cr.syncRecordNames.map(x => String(x).trim()).filter(Boolean);
    }
    if (syncRecordNames.length === 0) {
        return { ok: false, message: `jobs[${index}]: syncRecordNames must be non-empty when provided` };
    }

    return {
        ok: true,
        value: {
            id: idRaw,
            provider: "namecheap",
            enabled,
            credentials: {
                apiUser,
                apiKey,
                clientIp,
                sandbox,
                syncRecordNames
            },
            domainMode,
            domains: domainMode === "explicit" ? domains : [],
            matchNote,
            intervalMs,
            ipLookupTimeoutMs,
            ipv4Services: v4.value,
            ipv6Services: v6.value
        }
    };
}

/**
 * Snapshot apex list and DNS-console context once per summary / scheduler / sync pass so each
 * job reuses the same data (avoids repeated env merges and apex work).
 *
 * @param {(() => string[] | undefined) | undefined} getApexDomains
 * @param {(() => { dnsConsole?: object | null, env?: object } | null | undefined) | undefined} getDnsConsoleContext
 * @returns {{
 *   getApexDomains: () => string[],
 *   getDnsConsoleContext?: () => { dnsConsole?: object | null, env?: object }
 * }}
 */
export function snapshotDdnsResolveContext(getApexDomains, getDnsConsoleContext) {
    const apexSnapshot = typeof getApexDomains === "function" ? (getApexDomains() ?? []) : [];
    const getApex = () => apexSnapshot;
    if (typeof getDnsConsoleContext !== "function") {
        return { getApexDomains: getApex, getDnsConsoleContext: undefined };
    }
    const dnsSnapshot = getDnsConsoleContext() ?? {};
    return {
        getApexDomains: getApex,
        getDnsConsoleContext: () => dnsSnapshot
    };
}

/**
 * @param {object} stored - validated job row
 * @param {() => string[] | undefined} getApexDomains
 * @param {() => { dnsConsole?: object | null, env?: object } | null | undefined} [getDnsConsoleContext]
 * @returns {{ domains: string[], domainListSource: DdnsDomainListSource }}
 */
export function resolveDomainsForJob(job, getApexDomains, getDnsConsoleContext) {
    if (job.domainMode === "apex") {
        const list = (typeof getApexDomains === "function" ? getApexDomains() : []) ?? [];
        if (typeof getDnsConsoleContext !== "function") {
            return { domains: [...list], domainListSource: "STORED_APEX" };
        }
        const ctx = getDnsConsoleContext() ?? {};
        const dnsConsole = ctx.dnsConsole ?? null;
        const env = ctx.env ?? process.env;
        const filtered = list.filter(d => apexEligibleForDdnsProvider(job.provider, d, dnsConsole, env));
        return { domains: filtered, domainListSource: "STORED_APEX" };
    }
    return { domains: [...job.domains], domainListSource: "STORED_EXPLICIT" };
}

function jobPublicView(job, getApexDomains, getDnsConsoleContext) {
    const { domains, domainListSource } = resolveDomainsForJob(job, getApexDomains, getDnsConsoleContext);
    let credentialsConfigured = false;
    if (job.provider === "porkbun") {
        const c = job.credentials || {};
        credentialsConfigured = !!(c.porkbunApiKey && c.porkbunSecretKey);
    } else if (job.provider === "namecheap") {
        const c = job.credentials || {};
        credentialsConfigured = !!(c.apiUser && c.apiKey && c.clientIp);
    }

    const schedulerWouldRun = job.enabled && credentialsConfigured && domains.length > 0;
    let schedulerState = "disabled";
    if (!job.enabled) schedulerState = "disabled";
    else if (!credentialsConfigured) schedulerState = "missing_credentials";
    else if (domains.length === 0) schedulerState = "no_domains";
    else schedulerState = "running";

    const base = {
        id: job.id,
        provider: job.provider,
        enabled: job.enabled,
        credentialsConfigured,
        domains,
        domainListSource,
        domainMode: job.domainMode,
        matchNote: job.matchNote,
        intervalMs: job.intervalMs,
        ipLookupTimeoutMs: job.ipLookupTimeoutMs,
        ipv4Services: [...job.ipv4Services],
        ipv6Services: [...job.ipv6Services],
        schedulerWouldRun,
        schedulerState
    };

    if (job.provider === "porkbun") {
        return {
            ...base,
            porkbunApiBaseUrl: job.credentials.porkbunApiBaseUrl || DEFAULT_PORKBUN_API_BASE_URL
        };
    }
    return {
        ...base,
        namecheapSandbox: Boolean(job.credentials.sandbox),
        namecheapSyncRecordNames: [...(job.credentials.syncRecordNames || ["@"])]
    };
}

function unconfiguredSummary() {
    return {
        schemaVersion: DDNS_SCHEMA_VERSION,
        provider: "porkbun",
        configSource: "none",
        configInvalid: false,
        configInvalidMessage: null,
        jobs: [],
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
 * @param {{ getApexDomains: () => string[] | undefined, stored: object | null, getDnsConsoleContext?: () => { dnsConsole?: object | null, env?: object } | null | undefined }} ctx
 */
export function buildDdnsPublicSummary(ctx) {
    const { getApexDomains, stored, getDnsConsoleContext } = ctx;

    if (stored) {
        const parsed = normalizeStoredDdns(stored);
        if (!parsed.ok) {
            return {
                schemaVersion: DDNS_SCHEMA_VERSION,
                provider: "porkbun",
                configSource: "sqlite",
                configInvalid: true,
                configInvalidMessage: parsed.message,
                jobs: [],
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
                schedulerState: "disabled"
            };
        }

        const doc = parsed.value;
        const snap = snapshotDdnsResolveContext(getApexDomains, getDnsConsoleContext);
        const jobViews = doc.jobs.map(j => jobPublicView(j, snap.getApexDomains, snap.getDnsConsoleContext));
        const anyRun = jobViews.some(j => j.schedulerWouldRun);
        const first = doc.jobs[0];
        const firstView = jobViews[0];
        let aggState = "running";
        if (jobViews.length === 0) aggState = "not_configured";
        else if (!jobViews.some(j => j.enabled)) aggState = "disabled";
        else if (!anyRun) {
            const miss = jobViews.find(j => j.enabled && j.schedulerState === "missing_credentials");
            const nod = jobViews.find(j => j.enabled && j.schedulerState === "no_domains");
            aggState = miss ? "missing_credentials" : nod ? "no_domains" : "disabled";
        }

        return {
            schemaVersion: DDNS_SCHEMA_VERSION,
            provider: first?.provider ?? "porkbun",
            configSource: "sqlite",
            configInvalid: false,
            configInvalidMessage: null,
            jobs: jobViews,
            enabled: firstView?.enabled ?? false,
            credentialsConfigured: firstView?.credentialsConfigured ?? false,
            domains: firstView?.domains ?? [],
            domainListSource: firstView?.domainListSource ?? "NONE",
            domainMode: firstView?.domainMode ?? null,
            matchNote: firstView?.matchNote ?? "match:reverse-proxy-ddns",
            intervalMs: firstView?.intervalMs ?? 300_000,
            ipLookupTimeoutMs: firstView?.ipLookupTimeoutMs ?? 8000,
            ipv4Services: firstView?.ipv4Services ?? [...DEFAULT_IPV4_SERVICES],
            ipv6Services: firstView?.ipv6Services ?? [...DEFAULT_IPV6_SERVICES],
            porkbunApiBaseUrl: first?.provider === "porkbun" ? firstView?.porkbunApiBaseUrl : DEFAULT_PORKBUN_API_BASE_URL,
            schedulerWouldRun: anyRun,
            schedulerState: aggState
        };
    }

    return unconfiguredSummary();
}

/**
 * @param {{ persistence: { getDdnsSettings?: () => object | null, getDdnsLastRun?: () => object | null }, getApexDomains: () => string[] | undefined, getDnsConsoleContext?: () => { dnsConsole?: object | null, env?: object } | null | undefined }} ctx
 * @param {number} [nowMs]
 */
export function getDdnsSchedulerPlan(ctx, nowMs = Date.now()) {
    const { persistence, getApexDomains, getDnsConsoleContext } = ctx;
    const storedRaw = typeof persistence.getDdnsSettings === "function" ? persistence.getDdnsSettings() : null;

    if (!storedRaw) {
        return {
            nextDelayMs: 60_000,
            logReason: "ddns_not_configured",
            logMessage: "No DDNS settings in SQLite; configure via PUT /api/v1/ddns or the management UI",
            dueJobs: []
        };
    }

    const parsed = normalizeStoredDdns(storedRaw);
    if (!parsed.ok) {
        return {
            nextDelayMs: 60_000,
            logReason: "invalid_stored_ddns",
            logMessage: parsed.message,
            dueJobs: []
        };
    }

    const doc = parsed.value;
    const snap = snapshotDdnsResolveContext(getApexDomains, getDnsConsoleContext);
    const lastRunBlob =
        typeof persistence.getDdnsLastRun === "function" ? persistence.getDdnsLastRun() : null;
    const lastByJob =
        lastRunBlob && typeof lastRunBlob === "object" && lastRunBlob.jobs && typeof lastRunBlob.jobs === "object"
            ? /** @type {Record<string, { at?: string }>} */ (lastRunBlob.jobs)
            : {};

    const dueJobs = [];
    let minRemaining = Infinity;

    for (const job of doc.jobs) {
        const { domains } = resolveDomainsForJob(job, snap.getApexDomains, snap.getDnsConsoleContext);
        let credOk = false;
        if (job.provider === "porkbun") {
            const c = job.credentials || {};
            credOk = !!(c.porkbunApiKey && c.porkbunSecretKey);
        } else if (job.provider === "namecheap") {
            const c = job.credentials || {};
            credOk = !!(c.apiUser && c.apiKey && c.clientIp);
        }

        const runnable = job.enabled && credOk && domains.length > 0;
        const lr = lastByJob[job.id];
        const lastAt = lr && typeof lr.at === "string" ? Date.parse(lr.at) : NaN;
        const elapsed = Number.isFinite(lastAt) ? nowMs - lastAt : Infinity;
        const remaining = runnable ? (Number.isFinite(lastAt) ? Math.max(0, job.intervalMs - elapsed) : 0) : Infinity;
        minRemaining = Math.min(minRemaining, remaining);

        if (!runnable) continue;
        const isDue = !Number.isFinite(lastAt) || elapsed >= job.intervalMs;
        if (isDue) {
            dueJobs.push({
                jobId: job.id,
                job,
                domains,
                matchNote: job.matchNote,
                ipLookupTimeoutMs: job.ipLookupTimeoutMs,
                ipv4Services: job.ipv4Services,
                ipv6Services: job.ipv6Services
            });
        }
    }

    const nextDelayMs =
        minRemaining === Infinity ? 60_000 : clampDelay(Math.max(1000, Math.min(minRemaining, INTERVAL_MAX_MS)));

    return {
        nextDelayMs,
        logReason: null,
        logMessage: null,
        dueJobs
    };
}

/**
 * @deprecated Use getDdnsSchedulerPlan; kept for tests that assert single-job tick shape.
 * @param {{ persistence: { getDdnsSettings?: () => object | null }, getApexDomains: () => string[] | undefined, getDnsConsoleContext?: () => { dnsConsole?: object | null, env?: object } | null | undefined }} ctx
 */
export function getRuntimeDdnsTick(ctx) {
    const plan = getDdnsSchedulerPlan(ctx, Date.now());
    if (plan.logReason || plan.dueJobs.length === 0) {
        const jr = plan.logReason;
        return {
            shouldRun: false,
            nextDelayMs: plan.nextDelayMs,
            logReason: jr ?? "ddns_no_due_jobs",
            logMessage: plan.logMessage,
            domains: [],
            matchNote: "",
            apiKey: "",
            secretKey: "",
            ipLookupTimeoutMs: 8000,
            ipv4Services: [...DEFAULT_IPV4_SERVICES],
            ipv6Services: [...DEFAULT_IPV6_SERVICES],
            porkbunApiBaseUrl: DEFAULT_PORKBUN_API_BASE_URL
        };
    }
    const first = plan.dueJobs[0];
    const job = first.job;
    if (job.provider !== "porkbun") {
        return {
            shouldRun: true,
            nextDelayMs: plan.nextDelayMs,
            logReason: null,
            logMessage: null,
            domains: first.domains,
            matchNote: first.matchNote,
            apiKey: "",
            secretKey: "",
            ipLookupTimeoutMs: first.ipLookupTimeoutMs,
            ipv4Services: first.ipv4Services,
            ipv6Services: first.ipv6Services,
            porkbunApiBaseUrl: DEFAULT_PORKBUN_API_BASE_URL,
            jobId: job.id,
            provider: job.provider
        };
    }
    const c = job.credentials || {};
    return {
        shouldRun: true,
        nextDelayMs: plan.nextDelayMs,
        logReason: null,
        logMessage: null,
        domains: first.domains,
        matchNote: first.matchNote,
        apiKey: c.porkbunApiKey,
        secretKey: c.porkbunSecretKey,
        ipLookupTimeoutMs: first.ipLookupTimeoutMs,
        ipv4Services: first.ipv4Services,
        ipv6Services: first.ipv6Services,
        porkbunApiBaseUrl: c.porkbunApiBaseUrl,
        jobId: job.id,
        provider: job.provider
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
 * @param {object | null} prevDoc
 * @param {object} body
 * @param {(s: string) => boolean} isValidApexFQDN
 */
function mergePutDdnsDocumentV2(prevDoc, body, isValidApexFQDN) {
    const prevById = new Map(prevDoc.jobs.map(j => [j.id, j]));
    const jobsIn = body.jobs;
    const out = [];
    for (let i = 0; i < jobsIn.length; i++) {
        const raw = jobsIn[i];
        if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
            return { ok: false, message: `jobs[${i}] must be an object` };
        }
        const o = /** @type {Record<string, unknown>} */ (raw);
        const idRaw = o.id != null ? String(o.id).trim() : "";
        if (!isValidDdnsJobId(idRaw)) {
            return { ok: false, message: `jobs[${i}]: invalid id` };
        }
        const prevJob = prevById.get(idRaw);
        const merged = mergeOneJobPut(o, prevJob, i, isValidApexFQDN);
        if (!merged.ok) return merged;
        out.push(merged.value);
    }
    return { ok: true, value: { version: DDNS_SCHEMA_VERSION, jobs: out } };
}

/**
 * @param {Record<string, unknown>} body
 * @param {object | undefined} prevJob
 * @param {number} index
 * @param {(s: string) => boolean} isValidApexFQDN
 */
function mergeOneJobPut(body, prevJob, index, isValidApexFQDN) {
    const provider = String(body.provider ?? prevJob?.provider ?? "")
        .trim()
        .toLowerCase();
    if (provider !== "porkbun" && provider !== "namecheap") {
        return { ok: false, message: `jobs[${index}]: unsupported provider` };
    }

    const enabled =
        body.enabled === undefined && prevJob ? Boolean(prevJob.enabled) : Boolean(body.enabled);

    const dm = body.domainMode;
    const domainMode =
        dm === "explicit"
            ? "explicit"
            : dm === "apex"
              ? "apex"
              : prevJob?.domainMode === "explicit"
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
    } else if (domainMode === "explicit" && prevJob?.domainMode === "explicit" && Array.isArray(prevJob.domains)) {
        domains = prevJob.domains.map(d => String(d).trim().toLowerCase()).filter(Boolean);
    }

    for (const d of domains) {
        if (!isValidApexFQDN(d)) {
            return { ok: false, message: `Invalid apex domain: ${d}` };
        }
    }

    const matchNoteRaw = body.matchNote != null ? String(body.matchNote).trim() : "";
    const matchNote =
        matchNoteRaw.length > 0
            ? matchNoteRaw
            : prevJob
              ? String(prevJob.matchNote ?? "").trim()
              : "match:reverse-proxy-ddns";
    if (matchNote.length < NOTE_MIN || matchNote.length > NOTE_MAX) {
        return { ok: false, message: `matchNote must be between ${NOTE_MIN} and ${NOTE_MAX} characters` };
    }

    const intervalMs = clampInt(
        body.intervalMs,
        INTERVAL_MIN_MS,
        INTERVAL_MAX_MS,
        prevJob?.intervalMs ?? 300_000
    );
    const ipLookupTimeoutMs = clampInt(
        body.ipLookupTimeoutMs,
        LOOKUP_MIN_MS,
        LOOKUP_MAX_MS,
        prevJob?.ipLookupTimeoutMs ?? 8000
    );

    const ipv4Source =
        body.ipv4Services !== undefined && body.ipv4Services !== null ? body.ipv4Services : prevJob?.ipv4Services;
    const v4 = parseIpv4ServicesField(ipv4Source);
    if (!v4.ok) return v4;

    const ipv6Source =
        body.ipv6Services !== undefined && body.ipv6Services !== null ? body.ipv6Services : prevJob?.ipv6Services;
    const v6 = parseIpv6ServicesField(ipv6Source);
    if (!v6.ok) return v6;

    if (domainMode === "explicit" && domains.length === 0) {
        return { ok: false, message: "domainMode explicit requires a non-empty domains list" };
    }

    if (provider === "porkbun") {
        const credIn = body.credentials != null && typeof body.credentials === "object" && !Array.isArray(body.credentials) ? body.credentials : {};
        const ci = /** @type {Record<string, unknown>} */ (credIn);
        let porkbunApiKey = ci.porkbunApiKey != null ? String(ci.porkbunApiKey).trim() : "";
        let porkbunSecretKey = ci.porkbunSecretKey != null ? String(ci.porkbunSecretKey).trim() : "";
        const prevC = prevJob?.provider === "porkbun" ? prevJob.credentials : null;
        if (prevC) {
            if (!porkbunApiKey) porkbunApiKey = String(prevC.porkbunApiKey ?? "").trim();
            if (!porkbunSecretKey) porkbunSecretKey = String(prevC.porkbunSecretKey ?? "").trim();
        }
        const baseSource =
            ci.porkbunApiBaseUrl !== undefined && ci.porkbunApiBaseUrl !== null
                ? ci.porkbunApiBaseUrl
                : prevC?.porkbunApiBaseUrl;
        const base = parsePorkbunApiBaseUrlField(baseSource);
        if (!base.ok) return base;

        if (!porkbunApiKey || !porkbunSecretKey) {
            return {
                ok: false,
                message: "porkbunApiKey and porkbunSecretKey are required (send both, or omit to keep stored keys)"
            };
        }

        return {
            ok: true,
            value: {
                id: String(body.id).trim(),
                provider: "porkbun",
                enabled,
                credentials: {
                    porkbunApiKey,
                    porkbunSecretKey,
                    porkbunApiBaseUrl: base.value
                },
                domainMode,
                domains: domainMode === "explicit" ? domains : [],
                matchNote,
                intervalMs,
                ipLookupTimeoutMs,
                ipv4Services: v4.value,
                ipv6Services: v6.value
            }
        };
    }

    const credIn = body.credentials != null && typeof body.credentials === "object" && !Array.isArray(body.credentials) ? body.credentials : {};
    const ci = /** @type {Record<string, unknown>} */ (credIn);
    let apiUser = ci.apiUser != null ? String(ci.apiUser).trim() : "";
    let apiKey = ci.apiKey != null ? String(ci.apiKey).trim() : "";
    let clientIp = ci.clientIp != null ? String(ci.clientIp).trim() : "";
    const sandbox = ci.sandbox !== undefined ? Boolean(ci.sandbox) : Boolean(prevJob?.credentials?.sandbox);
    let syncRecordNames = prevJob?.credentials?.syncRecordNames || ["@"];
    if (Array.isArray(ci.syncRecordNames)) {
        syncRecordNames = ci.syncRecordNames.map(x => String(x).trim()).filter(Boolean);
    }
    const prevC = prevJob?.provider === "namecheap" ? prevJob.credentials : null;
    if (prevC) {
        if (!apiUser) apiUser = String(prevC.apiUser ?? "").trim();
        if (!apiKey) apiKey = String(prevC.apiKey ?? "").trim();
        if (!clientIp) clientIp = String(prevC.clientIp ?? "").trim();
    }
    if (!apiUser || !apiKey || !clientIp) {
        return { ok: false, message: "namecheap apiUser, apiKey, and clientIp are required" };
    }
    if (syncRecordNames.length === 0) {
        return { ok: false, message: "syncRecordNames must be non-empty" };
    }

    return {
        ok: true,
        value: {
            id: String(body.id).trim(),
            provider: "namecheap",
            enabled,
            credentials: {
                apiUser,
                apiKey,
                clientIp,
                sandbox,
                syncRecordNames
            },
            domainMode,
            domains: domainMode === "explicit" ? domains : [],
            matchNote,
            intervalMs,
            ipLookupTimeoutMs,
            ipv4Services: v4.value,
            ipv6Services: v6.value
        }
    };
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

    const prevNorm = prev ? normalizeStoredDdns(prev) : { ok: true, value: { version: DDNS_SCHEMA_VERSION, jobs: [] } };
    if (!prevNorm.ok) {
        return { ok: false, message: prevNorm.message };
    }
    const prevDoc = prevNorm.value;

    if (body.version === DDNS_SCHEMA_VERSION && Array.isArray(body.jobs)) {
        return mergePutDdnsDocumentV2(prevDoc, body, isValidApexFQDN);
    }

    const flatPrev = porkbunJobToV1Flat(prevDoc.jobs.find(j => j.id === LEGACY_V1_JOB_ID && j.provider === "porkbun"));
    const m = mergeV1FlatRow(flatPrev, body, isValidApexFQDN);
    if (!m.ok) return m;
    const newJob = v1FlatToPorkbunJob(m.value, LEGACY_V1_JOB_ID);
    const others = prevDoc.jobs.filter(j => !(j.id === LEGACY_V1_JOB_ID && j.provider === "porkbun"));
    return { ok: true, value: { version: DDNS_SCHEMA_VERSION, jobs: [newJob, ...others] } };
}

/**
 * @param {object | null} flatPrev
 * @param {object} body
 * @param {(s: string) => boolean} isValidApexFQDN
 */
function mergeV1FlatRow(flatPrev, body, isValidApexFQDN) {
    const enabled =
        body.enabled === undefined && flatPrev ? Boolean(flatPrev.enabled) : Boolean(body.enabled);

    let porkbunApiKey = body.porkbunApiKey != null ? String(body.porkbunApiKey).trim() : "";
    let porkbunSecretKey = body.porkbunSecretKey != null ? String(body.porkbunSecretKey).trim() : "";
    if (flatPrev) {
        if (!porkbunApiKey) porkbunApiKey = String(flatPrev.porkbunApiKey ?? "").trim();
        if (!porkbunSecretKey) porkbunSecretKey = String(flatPrev.porkbunSecretKey ?? "").trim();
    }

    const dm = body.domainMode;
    const domainMode =
        dm === "explicit"
            ? "explicit"
            : dm === "apex"
              ? "apex"
              : flatPrev?.domainMode === "explicit"
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
    if (domainMode === "explicit" && domains.length === 0 && flatPrev?.domainMode === "explicit" && Array.isArray(flatPrev.domains)) {
        domains = flatPrev.domains.map(d => String(d).trim().toLowerCase()).filter(Boolean);
    }

    for (const d of domains) {
        if (!isValidApexFQDN(d)) {
            return { ok: false, message: `Invalid apex domain: ${d}` };
        }
    }

    const matchNoteRaw = body.matchNote != null ? String(body.matchNote).trim() : "";
    const matchNote =
        matchNoteRaw.length > 0 ? matchNoteRaw : flatPrev ? String(flatPrev.matchNote ?? "").trim() : "match:reverse-proxy-ddns";
    if (matchNote.length < NOTE_MIN || matchNote.length > NOTE_MAX) {
        return { ok: false, message: `matchNote must be between ${NOTE_MIN} and ${NOTE_MAX} characters` };
    }

    const intervalMs = clampInt(body.intervalMs, INTERVAL_MIN_MS, INTERVAL_MAX_MS, flatPrev?.intervalMs ?? 300_000);
    const ipLookupTimeoutMs = clampInt(
        body.ipLookupTimeoutMs,
        LOOKUP_MIN_MS,
        LOOKUP_MAX_MS,
        flatPrev?.ipLookupTimeoutMs ?? 8000
    );

    const ipv4Source =
        body.ipv4Services !== undefined && body.ipv4Services !== null ? body.ipv4Services : flatPrev?.ipv4Services;
    const v4 = parseIpv4ServicesField(ipv4Source);
    if (!v4.ok) return v4;

    const ipv6Source =
        body.ipv6Services !== undefined && body.ipv6Services !== null ? body.ipv6Services : flatPrev?.ipv6Services;
    const v6 = parseIpv6ServicesField(ipv6Source);
    if (!v6.ok) return v6;

    const baseSource =
        body.porkbunApiBaseUrl !== undefined && body.porkbunApiBaseUrl !== null
            ? body.porkbunApiBaseUrl
            : flatPrev?.porkbunApiBaseUrl;
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
