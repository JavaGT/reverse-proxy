/**
 * Server settings stored in SQLite `meta.server_settings` (JSON object).
 * Keys are camelCase; values are merged over `process.env` at startup and on PUT.
 * Env names match historical .env variables.
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
    /** Env-tier fallback when `meta.root_domains.dnsConsole` has no `defaultProvider` (see `resolveDnsConsoleLinks`). */
    { key: "dnsConsoleDefaultProvider", env: "DNS_CONSOLE_DEFAULT_PROVIDER", type: "string" },
    { key: "ipLookupTimeoutMs", env: "IP_LOOKUP_TIMEOUT_MS", type: "int" },
    { key: "publicIngressProbeHttpsPort", env: "PUBLIC_INGRESS_PROBE_HTTPS_PORT", type: "int" },
    { key: "publicIngressProbeTimeoutMs", env: "PUBLIC_INGRESS_PROBE_TIMEOUT_MS", type: "int" }
];

const SECRET_KEYS = new Set(["managementRegistrationSecret", "managementSessionSecret"]);

export function isSecretKey(key) {
    return SECRET_KEYS.has(key);
}

/**
 * Convert a stored DB value to the string placed in `process.env` (or undefined to omit).
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
    const s = String(raw).trim();
    return s === "" ? undefined : s;
}

/**
 * Apply sparse DB overrides after loading `.env` baseline.
 * @param {Record<string, unknown>} dbSparse - camelCase keys present only when overridden
 */
export function applyServerSettingsToProcessEnv(dbSparse) {
    for (const def of SERVER_SETTING_DEFS) {
        if (!Object.prototype.hasOwnProperty.call(dbSparse, def.key)) continue;
        const raw = dbSparse[def.key];
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
 * Effective raw string for a setting (DB override or process.env after merge).
 * @param {Record<string, unknown>} dbSparse
 * @param {ServerSettingDef} def
 */
function effectiveRawForDef(dbSparse, def) {
    if (Object.prototype.hasOwnProperty.call(dbSparse, def.key)) {
        const v = dbSparse[def.key];
        if (v === null || v === undefined) return undefined;
        return storedValueToEnvString(def, v) ?? String(v);
    }
    return process.env[def.env];
}

/**
 * Build merged view (camelCase) for API GET.
 * @param {Record<string, unknown>} dbSparse
 */
export function buildPublicSettingsView(dbSparse) {
    /** @type {Record<string, string | number | boolean | null>} */
    const settings = {};
    for (const def of SERVER_SETTING_DEFS) {
        if (isSecretKey(def.key)) {
            settings[def.key] = null;
            continue;
        }
        const raw = effectiveRawForDef(dbSparse, def);
        if (def.key === "managementAutoPublicEgressIp") {
            const v = process.env.MANAGEMENT_AUTO_PUBLIC_EGRESS_IP?.trim().toLowerCase();
            settings[def.key] = !(v === "0" || v === "false");
            continue;
        }
        if (def.type === "bool") {
            settings[def.key] = raw === "true" || raw === "1";
            continue;
        }
        if (def.type === "int" || def.type === "port") {
            const n = parseInt(String(raw ?? "").trim(), 10);
            settings[def.key] = Number.isFinite(n) ? n : null;
            continue;
        }
        settings[def.key] = raw != null && String(raw).trim() !== "" ? String(raw).trim() : "";
    }
    const reg =
        (Object.prototype.hasOwnProperty.call(dbSparse, "managementRegistrationSecret") &&
            dbSparse.managementRegistrationSecret &&
            String(dbSparse.managementRegistrationSecret).trim()) ||
        process.env.MANAGEMENT_REGISTRATION_SECRET?.trim();
    const sess =
        (Object.prototype.hasOwnProperty.call(dbSparse, "managementSessionSecret") &&
            dbSparse.managementSessionSecret &&
            String(dbSparse.managementSessionSecret).trim()) ||
        process.env.MANAGEMENT_SESSION_SECRET?.trim();
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
