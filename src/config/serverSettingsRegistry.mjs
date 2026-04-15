/**
 * Server settings stored in SQLite `meta.server_settings` (JSON object).
 * Keys are camelCase; effective values are defaults merged with sparse DB keys, then synced to `process.env`
 * (legacy env var names) for internal reads.
 *
 * Larger follow-up (optional): replace this `process.env` bridge with a single injected read-only
 * config object passed into services that currently read env names — same merge rules, fewer globals.
 */

/** @typedef {{ key: string, env: string, type: "string" | "int" | "bool" | "port" }} ServerSettingDef */

/** @type {ServerSettingDef[]} */
export const SERVER_SETTING_DEFS = [
    { key: "tlsCertDir", env: "TLS_CERT_DIR", type: "string" },
    { key: "rootDomains", env: "ROOT_DOMAINS", type: "string" },
    { key: "managementSubdomain", env: "MANAGEMENT_SUBDOMAIN", type: "string" },
    { key: "managementBaseDomain", env: "MANAGEMENT_BASE_DOMAIN", type: "string" },
    { key: "managementInterfacePort", env: "MANAGEMENT_INTERFACE_PORT", type: "port" },
    { key: "healthCheckIntervalMs", env: "HEALTH_CHECK_INTERVAL_MS", type: "int" },
    { key: "publicUrlHttpsPrefix", env: "PUBLIC_URL_HTTPS_PREFIX", type: "string" },
    { key: "publicUrlHttpPrefix", env: "PUBLIC_URL_HTTP_PREFIX", type: "string" },
    { key: "logRequests", env: "LOG_REQUESTS", type: "bool" },
    { key: "managementTrustProxy", env: "MANAGEMENT_TRUST_PROXY", type: "string" },
    { key: "managementRateLimitMax", env: "MANAGEMENT_RATE_LIMIT_MAX", type: "int" },
    { key: "managementRateLimitWindowMs", env: "MANAGEMENT_RATE_LIMIT_WINDOW_MS", type: "int" },
    { key: "managementDebugLocalOperator", env: "MANAGEMENT_DEBUG_LOCAL_OPERATOR", type: "bool" },
    { key: "managementLocalOperatorIps", env: "MANAGEMENT_LOCAL_OPERATOR_IPS", type: "string" },
    { key: "managementAutoPublicEgressIp", env: "MANAGEMENT_AUTO_PUBLIC_EGRESS_IP", type: "bool" },
    { key: "managementRegistrationSecret", env: "MANAGEMENT_REGISTRATION_SECRET", type: "string" },
    { key: "managementSessionSecret", env: "MANAGEMENT_SESSION_SECRET", type: "string" },
    { key: "managementAuthRpId", env: "MANAGEMENT_AUTH_RP_ID", type: "string" },
    { key: "managementAuthOrigin", env: "MANAGEMENT_AUTH_ORIGIN", type: "string" },
    { key: "managementAuthCookieSecure", env: "MANAGEMENT_AUTH_COOKIE_SECURE", type: "string" },
    { key: "managementAuthDataDir", env: "MANAGEMENT_AUTH_DATA_DIR", type: "string" },
    { key: "dnsLookupTimeoutMs", env: "DNS_LOOKUP_TIMEOUT_MS", type: "int" },
    /** Fallback when `meta.root_domains.dnsConsole` has no `defaultProvider` (see `resolveDnsConsoleLinks`). */
    { key: "dnsConsoleDefaultProvider", env: "DNS_CONSOLE_DEFAULT_PROVIDER", type: "string" },
    { key: "ipLookupTimeoutMs", env: "IP_LOOKUP_TIMEOUT_MS", type: "int" },
    { key: "publicIngressProbeHttpsPort", env: "PUBLIC_INGRESS_PROBE_HTTPS_PORT", type: "int" },
    { key: "publicIngressProbeTimeoutMs", env: "PUBLIC_INGRESS_PROBE_TIMEOUT_MS", type: "int" }
];

/** Built-in defaults when a key is absent from SQLite or cleared (`null` removes a stored override). */
export const SERVER_SETTING_DEFAULTS = Object.freeze({
    tlsCertDir: "",
    rootDomains: "javagrant.ac.nz",
    managementSubdomain: "reverse-proxy",
    managementBaseDomain: "",
    managementInterfacePort: 24789,
    healthCheckIntervalMs: 30_000,
    publicUrlHttpsPrefix: "https",
    publicUrlHttpPrefix: "http",
    logRequests: false,
    managementTrustProxy: "",
    managementRateLimitMax: 300,
    managementRateLimitWindowMs: 60_000,
    managementDebugLocalOperator: false,
    managementLocalOperatorIps: "",
    managementAutoPublicEgressIp: false,
    managementRegistrationSecret: "",
    managementSessionSecret: "",
    managementAuthRpId: "",
    managementAuthOrigin: "",
    managementAuthCookieSecure: "",
    managementAuthDataDir: "",
    dnsLookupTimeoutMs: 5000,
    dnsConsoleDefaultProvider: "",
    ipLookupTimeoutMs: 8000,
    publicIngressProbeHttpsPort: 443,
    publicIngressProbeTimeoutMs: 5000
});

const SECRET_KEYS = new Set(["managementRegistrationSecret", "managementSessionSecret"]);

/**
 * When `meta.server_settings` omits a key, use a non-empty value from `process.env` (e.g. `.env`)
 * so applying defaults does not delete variables still intended for bootstrap.
 */
const ENV_BOOTSTRAP_WHEN_SQLITE_OMITS = new Set(["tlsCertDir", "managementSessionSecret"]);

/**
 * @param {Record<string, unknown> | null | undefined} dbSparse
 * @param {Record<string, unknown>} merged - mutated; output of `mergeServerSettingsSparseWithDefaults`
 */
export function overlayEnvBootstrapForOmittedSqliteKeys(dbSparse, merged) {
    const s = dbSparse && typeof dbSparse === "object" && !Array.isArray(dbSparse) ? dbSparse : {};
    for (const key of ENV_BOOTSTRAP_WHEN_SQLITE_OMITS) {
        if (Object.prototype.hasOwnProperty.call(s, key)) continue;
        const def = SERVER_SETTING_DEFS.find(d => d.key === key);
        if (!def) continue;
        const raw = process.env[def.env];
        const t = raw !== undefined && raw !== null ? String(raw).trim() : "";
        if (t !== "") {
            merged[key] = t;
        }
    }
}

export function isSecretKey(key) {
    return SECRET_KEYS.has(key);
}

/**
 * @param {Record<string, unknown> | null | undefined} sparse
 * @returns {Record<string, unknown>}
 */
export function mergeServerSettingsSparseWithDefaults(sparse) {
    const s = sparse && typeof sparse === "object" && !Array.isArray(sparse) ? sparse : {};
    /** @type {Record<string, unknown>} */
    const out = { ...SERVER_SETTING_DEFAULTS };
    for (const def of SERVER_SETTING_DEFS) {
        if (!Object.prototype.hasOwnProperty.call(s, def.key)) continue;
        const v = s[def.key];
        if (v === null) {
            out[def.key] = SERVER_SETTING_DEFAULTS[def.key];
        } else {
            out[def.key] = v;
        }
    }
    return out;
}

/**
 * Convert a merged value to the string placed in `process.env` (or undefined to delete / omit).
 * @param {ServerSettingDef} def
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function storedValueToEnvString(def, raw) {
    if (raw === undefined || raw === null) return undefined;
    if (def.key === "managementAutoPublicEgressIp") {
        if (raw === true || raw === "true" || raw === "1") return "";
        if (raw === false || raw === "false" || raw === "0") return "0";
        return undefined;
    }
    if (def.type === "bool") {
        if (raw === true || raw === "true" || raw === "1") return "true";
        if (raw === false || raw === "false" || raw === "0") return "false";
        return undefined;
    }
    if (def.type === "int" || def.type === "port") {
        const n = parseInt(String(raw).trim(), 10);
        if (!Number.isFinite(n)) return undefined;
        if (def.type === "port" && (n < 0 || n > 65535)) return undefined;
        return String(n);
    }
    const str = String(raw).trim();
    return str === "" ? undefined : str;
}

/**
 * @param {Record<string, unknown>} merged
 * @returns {Record<string, string>}
 */
export function mergedServerSettingsToEnvRecord(merged) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const def of SERVER_SETTING_DEFS) {
        const raw = merged[def.key];
        const envStr = storedValueToEnvString(def, raw);
        if (def.key === "managementAutoPublicEgressIp") {
            if (envStr === "") continue;
            if (envStr !== undefined) out[def.env] = envStr;
            continue;
        }
        if (envStr !== undefined) out[def.env] = envStr;
    }
    return out;
}

/**
 * @param {Record<string, unknown>} merged
 */
function syncMergedServerSettingsToProcessEnv(merged) {
    for (const def of SERVER_SETTING_DEFS) {
        const raw = merged[def.key];
        const envStr = storedValueToEnvString(def, raw);
        if (def.key === "managementAutoPublicEgressIp") {
            if (envStr === "") {
                delete process.env.MANAGEMENT_AUTO_PUBLIC_EGRESS_IP;
            } else if (envStr !== undefined) {
                process.env.MANAGEMENT_AUTO_PUBLIC_EGRESS_IP = envStr;
            }
            continue;
        }
        if (envStr !== undefined) {
            process.env[def.env] = envStr;
        } else {
            delete process.env[def.env];
        }
    }
}

/**
 * Merge sparse SQLite settings with defaults and sync every mapped key onto `process.env`.
 * @param {Record<string, unknown>} dbSparse
 */
export function applyServerSettingsToProcessEnv(dbSparse) {
    const merged = mergeServerSettingsSparseWithDefaults(dbSparse);
    overlayEnvBootstrapForOmittedSqliteKeys(dbSparse, merged);
    syncMergedServerSettingsToProcessEnv(merged);
}

/**
 * Build merged view (camelCase) for API GET.
 * @param {Record<string, unknown>} dbSparse
 */
export function buildPublicSettingsView(dbSparse) {
    const merged = mergeServerSettingsSparseWithDefaults(dbSparse);
    overlayEnvBootstrapForOmittedSqliteKeys(dbSparse, merged);
    /** @type {Record<string, string | number | boolean | null>} */
    const settings = {};
    for (const def of SERVER_SETTING_DEFS) {
        if (isSecretKey(def.key)) {
            settings[def.key] = null;
            continue;
        }
        const raw = merged[def.key];
        if (def.key === "managementAutoPublicEgressIp") {
            settings[def.key] = !(raw === false || raw === "false" || raw === "0");
            continue;
        }
        if (def.type === "bool") {
            settings[def.key] = raw === true || raw === "true" || raw === "1";
            continue;
        }
        if (def.type === "int" || def.type === "port") {
            const n = parseInt(String(raw ?? "").trim(), 10);
            settings[def.key] = Number.isFinite(n) ? n : null;
            continue;
        }
        settings[def.key] = raw != null && String(raw).trim() !== "" ? String(raw).trim() : "";
    }
    const reg = String(merged.managementRegistrationSecret ?? "").trim();
    const sess = String(merged.managementSessionSecret ?? "").trim();
    return {
        settings,
        secretsConfigured: {
            registrationSecret: Boolean(reg),
            sessionSecret: Boolean(sess)
        }
    };
}

/** Keys whose changes need a full process restart to take full effect everywhere. */
export const SERVER_SETTINGS_RESTART_KEYS = new Set([
    "tlsCertDir",
    "managementInterfacePort",
    "healthCheckIntervalMs",
    "managementSessionSecret",
    "managementTrustProxy",
    "managementRateLimitMax",
    "managementRateLimitWindowMs",
    "managementAuthDataDir"
]);
