/**
 * Single source for Settings page labels, hints, and grouping. Keys must match
 * {@link SERVER_SETTING_DEFS}; validated at module load.
 */

import { SERVER_SETTING_DEFS, isSecretKey } from "./serverSettingsRegistry.mjs";

/** @typedef {{ summary: string, open: boolean, keys: string[] }} ServerSettingUiGroup */

/**
 * @param {import("./serverSettingsRegistry.mjs").ServerSettingDef} def
 * @returns {"text" | "number" | "checkbox" | "password"}
 */
function uiInputType(def) {
    if (isSecretKey(def.key)) return "password";
    if (def.type === "bool") return "checkbox";
    if (def.type === "int" || def.type === "port") return "number";
    return "text";
}

/** @type {Record<string, { label: string, hint?: string }>} */
const UI_META = {
    tlsCertDir: { label: "TLS certificate directory", hint: "Let's Encrypt live path or PEM directory" },
    rootDomains: {
        label: "Root domains (comma-separated, bootstrap)",
        hint: "Overridden by Domains in SQLite when saved there"
    },
    managementSubdomain: { label: "Management subdomain" },
    managementBaseDomain: { label: "Management base domain (apex)" },
    managementInterfacePort: { label: "Management listener port (127.0.0.1)" },
    healthCheckIntervalMs: { label: "Health check interval (ms)" },
    publicUrlHttpsPrefix: { label: "Public URL HTTPS scheme prefix" },
    publicUrlHttpPrefix: { label: "Public URL HTTP scheme prefix" },
    logRequests: { label: "Log requests" },
    managementTrustProxy: { label: "Trust reverse proxy (set to 1)", hint: "1 or 0" },
    managementRateLimitMax: { label: "Management rate limit (max requests / window)" },
    managementRateLimitWindowMs: { label: "Management rate limit window (ms)" },
    managementDebugLocalOperator: { label: "Debug local-operator detection" },
    managementLocalOperatorIps: { label: "Extra local-operator IPs (comma-separated)" },
    managementAutoPublicEgressIp: { label: "Auto public egress IP for XFF match" },
    managementRegistrationSecret: {
        label: "Registration invite secret (optional)",
        hint: "Leave blank to keep unchanged; use Accounts page to copy"
    },
    managementSessionSecret: {
        label: "Session signing secret",
        hint: "Leave blank to keep unchanged"
    },
    managementAuthRpId: { label: "WebAuthn rpID (fallback)" },
    managementAuthOrigin: { label: "WebAuthn origin (fallback)" },
    managementAuthCookieSecure: { label: "Secure session cookies (1 or 0)" },
    managementAuthDataDir: { label: "Management auth data directory" },
    dnsLookupTimeoutMs: { label: "DNS lookup timeout (ms)" },
    dnsConsoleDefaultProvider: { label: "DNS console default provider", hint: "e.g. porkbun" },
    ipLookupTimeoutMs: { label: "Public IP lookup timeout (ms)" },
    publicIngressProbeHttpsPort: { label: "Public ingress HTTPS probe port" },
    publicIngressProbeTimeoutMs: { label: "Public ingress probe timeout (ms)" }
};

/** @type {ServerSettingUiGroup[]} */
export const SERVER_SETTING_UI_GROUPS = [
    {
        summary: "TLS, domains, management URL & health",
        open: true,
        keys: [
            "tlsCertDir",
            "rootDomains",
            "managementSubdomain",
            "managementBaseDomain",
            "managementInterfacePort",
            "healthCheckIntervalMs",
            "publicUrlHttpsPrefix",
            "publicUrlHttpPrefix",
            "logRequests"
        ]
    },
    {
        summary: "Management access, trust & rate limits",
        open: true,
        keys: [
            "managementTrustProxy",
            "managementRateLimitMax",
            "managementRateLimitWindowMs",
            "managementDebugLocalOperator",
            "managementLocalOperatorIps",
            "managementAutoPublicEgressIp"
        ]
    },
    {
        summary: "Sessions & WebAuthn",
        open: false,
        keys: [
            "managementRegistrationSecret",
            "managementSessionSecret",
            "managementAuthRpId",
            "managementAuthOrigin",
            "managementAuthCookieSecure",
            "managementAuthDataDir"
        ]
    },
    {
        summary: "DNS & connectivity probes",
        open: false,
        keys: [
            "dnsLookupTimeoutMs",
            "dnsConsoleDefaultProvider",
            "ipLookupTimeoutMs",
            "publicIngressProbeHttpsPort",
            "publicIngressProbeTimeoutMs"
        ]
    }
];

const _defKeys = new Set(SERVER_SETTING_DEFS.map(d => d.key));
for (const k of Object.keys(UI_META)) {
    if (!_defKeys.has(k)) {
        throw new Error(`serverSettingsUi: unknown UI_META key "${k}"`);
    }
}
for (const def of SERVER_SETTING_DEFS) {
    if (!UI_META[def.key]) {
        throw new Error(`serverSettingsUi: missing UI_META for "${def.key}"`);
    }
}

const _fieldKeys = new Set(SERVER_SETTING_DEFS.map(d => d.key));
for (const g of SERVER_SETTING_UI_GROUPS) {
    for (const k of g.keys) {
        if (!_fieldKeys.has(k)) {
            throw new Error(`serverSettingsUi: unknown group key "${k}"`);
        }
    }
}

/**
 * @returns {{
 *   fields: Array<{ key: string, label: string, type: "text" | "number" | "checkbox" | "password", hint?: string }>,
 *   groups: ServerSettingUiGroup[]
 * }}
 */
export function buildServerSettingsUiManifest() {
    const fields = SERVER_SETTING_DEFS.map(def => {
        const m = UI_META[def.key];
        const row = {
            key: def.key,
            label: m.label,
            type: uiInputType(def)
        };
        if (m.hint) row.hint = m.hint;
        return row;
    });
    return { fields, groups: SERVER_SETTING_UI_GROUPS };
}
