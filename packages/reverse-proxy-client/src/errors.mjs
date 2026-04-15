export class ManagementApiError extends Error {
    /**
     * @param {number} status
     * @param {string} code
     * @param {string} message
     * @param {unknown} [details]
     * @param {string | null | undefined} [resolution]
     */
    constructor(status, code, message, details = null, resolution = null) {
        super(message);
        this.name = "ManagementApiError";
        this.status = status;
        this.code = code;
        this.details = details;
        this.resolution = resolution ?? null;
    }
}
