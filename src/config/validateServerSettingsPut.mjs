import { isSecretKey, SERVER_SETTING_DEFS, storedValueToEnvString } from "./serverSettingsRegistry.mjs";

/**
 * @param {unknown} body
 * @returns {{ ok: true, partial: Record<string, unknown> } | { ok: false, message: string }}
 */
export function validateServerSettingsPut(body) {
    if (body == null || typeof body !== "object" || Array.isArray(body)) {
        return { ok: false, message: "Body must be a JSON object" };
    }

    /** @type {Record<string, unknown>} */
    const partial = {};

    for (const [k, v] of Object.entries(body)) {
        const def = SERVER_SETTING_DEFS.find(d => d.key === k);
        if (!def) continue;

        if (v === null) {
            partial[k] = null;
            continue;
        }

        if (isSecretKey(k)) {
            if (typeof v !== "string") {
                return { ok: false, message: `${k} must be a string` };
            }
            const t = v.trim();
            if (!t) {
                return { ok: false, message: `${k} cannot be empty when set (use null to clear the DB override)` };
            }
            partial[k] = t;
            continue;
        }

        if (def.key === "managementAutoPublicEgressIp") {
            partial[k] = v;
            continue;
        }

        const envStr = storedValueToEnvString(def, v);
        if (envStr === undefined) {
            return { ok: false, message: `Invalid value for ${k}` };
        }
        partial[k] = v;
    }

    return { ok: true, partial };
}
