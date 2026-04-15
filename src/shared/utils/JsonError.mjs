/**
 * Standard JSON error envelope for management API responses.
 * Optional `resolution` gives clients a short next step (also documented in OpenAPI).
 * @param {import("express").Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {object | array | null} [details]
 * @param {string | null} [resolution]
 */
export function sendJsonError(res, status, code, message, details = null, resolution = null) {
    const error = { code, message, details };
    if (resolution != null && String(resolution).trim() !== "") {
        error.resolution = String(resolution).trim();
    }
    return res.status(status).json({ error });
}
