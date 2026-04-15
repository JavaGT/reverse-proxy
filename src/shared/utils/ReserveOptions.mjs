const MAX_HEALTH_PATH_LENGTH = 256;

export class ReserveValidationError extends Error {
    /** @param {string} code */
    constructor(code, message) {
        super(message);
        this.name = "ReserveValidationError";
        this.code = code;
    }
}

/**
 * Validates healthPath for upstream probes (GET, 2xx/3xx — see docs).
 * @param {string} healthPath
 */
function validateHealthPath(healthPath) {
    if (typeof healthPath !== "string") {
        throw new ReserveValidationError("INVALID_HEALTH_PATH", "healthPath must be a string");
    }
    if (healthPath.length === 0) {
        return;
    }
    if (healthPath.length > MAX_HEALTH_PATH_LENGTH) {
        throw new ReserveValidationError(
            "INVALID_HEALTH_PATH",
            `healthPath must be at most ${MAX_HEALTH_PATH_LENGTH} characters`
        );
    }
    if (!healthPath.startsWith("/")) {
        throw new ReserveValidationError("INVALID_HEALTH_PATH", "healthPath must start with /");
    }
    if (/\s/.test(healthPath)) {
        throw new ReserveValidationError("INVALID_HEALTH_PATH", "healthPath must not contain whitespace");
    }
    if (healthPath.includes("//")) {
        throw new ReserveValidationError("INVALID_HEALTH_PATH", "healthPath must not contain //");
    }
}

/**
 * Normalizes reserve `options` from the API body: only healthPath and allowlist are stored.
 * @param {unknown} raw
 */
export function normalizeReserveOptions(raw) {
    if (raw == null) {
        return {};
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new ReserveValidationError("INVALID_REQUEST", "options must be an object");
    }

    const out = {};
    const h = raw.healthPath;
    if (h != null && h !== "") {
        validateHealthPath(h);
        out.healthPath = h;
    }

    if (raw.allowlist != null) {
        if (!Array.isArray(raw.allowlist)) {
            throw new ReserveValidationError("INVALID_REQUEST", "allowlist must be an array");
        }
        out.allowlist = raw.allowlist.map(String);
    }

    return out;
}
