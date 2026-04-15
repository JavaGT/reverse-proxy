export const DDNS_SCHEMA_VERSION = 2;

/** Stable id for a single migrated v1 configuration */
export const LEGACY_V1_JOB_ID = "default";

const JOB_ID_MAX = 64;
const MAX_JOBS = 32;

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isValidDdnsJobId(id) {
    const s = String(id ?? "").trim();
    if (!s || s.length > JOB_ID_MAX) return false;
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s);
}

/**
 * @param {string} jobId
 * @returns {string}
 */
export function sanitizeDdnsJobIdForMetaKey(jobId) {
    return String(jobId ?? "")
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, JOB_ID_MAX) || "job";
}
