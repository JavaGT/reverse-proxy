import { getFetch } from "./fetch.mjs";
import { createHttpClient } from "./httpClient.mjs";
import { createDbClient } from "./dbClient.mjs";
import { ManagementApiError } from "./errors.mjs";

function offlineOnly(operation) {
    return new ManagementApiError(
        503,
        "OFFLINE",
        `${operation} requires the live management server (database fallback does not support this operation)`,
        null,
        null
    );
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isTransportError(err) {
    return !(err instanceof ManagementApiError);
}

/**
 * @param {{
 *   baseUrl: string,
 *   dbPath: string,
 *   env?: NodeJS.ProcessEnv,
 *   healthTimeoutMs?: number,
 *   modeCacheTtlMs?: number,
 *   fetch?: typeof fetch,
 *   publicUrlHttpsPrefix?: string,
 *   publicUrlHttpPrefix?: string,
 *   defaultRootDomains?: string
 * }} options
 */
export function createAutoClient(options) {
    const fetchFn = options.fetch ?? getFetch();
    const http = createHttpClient({ baseUrl: options.baseUrl, fetch: fetchFn });
    const db = createDbClient({
        dbPath: options.dbPath,
        env: options.env,
        publicUrlHttpsPrefix: options.publicUrlHttpsPrefix,
        publicUrlHttpPrefix: options.publicUrlHttpPrefix,
        defaultRootDomains: options.defaultRootDomains
    });

    const healthTimeoutMs = options.healthTimeoutMs ?? 2500;
    const modeCacheTtlMs = options.modeCacheTtlMs ?? 5000;

    /** @type {'http' | 'db' | null} */
    let cachedMode = null;
    let cachedAt = 0;

    function invalidateModeCache() {
        cachedMode = null;
        cachedAt = 0;
    }

    async function probeManagementHttp() {
        try {
            const c = new AbortController();
            const id = setTimeout(() => c.abort(), healthTimeoutMs);
            const base = String(options.baseUrl).replace(/\/$/, "");
            const res = await fetchFn(`${base}/api/v1/health`, {
                signal: c.signal,
                headers: { Accept: "application/json" }
            });
            clearTimeout(id);
            if (res.ok) return /** @type {'http'} */ ("http");
        } catch {
            /* unreachable server */
        }
        return /** @type {'db'} */ ("db");
    }

    /**
     * @param {{ force?: boolean } | undefined} [opts]
     * @returns {Promise<'http' | 'db'>}
     */
    async function resolveMode(opts) {
        const force = opts?.force === true;
        const now = Date.now();
        if (!force && cachedMode !== null && now - cachedAt < modeCacheTtlMs) {
            return cachedMode;
        }
        const mode = await probeManagementHttp();
        cachedMode = mode;
        cachedAt = Date.now();
        return mode;
    }

    /**
     * @template T
     * @param {() => Promise<T>} fnHttp
     * @param {() => Promise<T>} fnDb
     * @returns {Promise<T>}
     */
    async function execHttpOrDb(fnHttp, fnDb) {
        let mode = await resolveMode();
        if (mode === "db") {
            return fnDb();
        }
        try {
            return await fnHttp();
        } catch (e) {
            if (!isTransportError(e)) {
                throw e;
            }
            invalidateModeCache();
            mode = await resolveMode({ force: true });
            if (mode === "db") {
                return fnDb();
            }
            return await fnHttp();
        }
    }

    /**
     * @template T
     * @param {string} operationName
     * @param {() => Promise<T>} fnHttp
     * @returns {Promise<T>}
     */
    async function execHttpOnly(operationName, fnHttp) {
        let mode = await resolveMode();
        if (mode === "db") {
            throw offlineOnly(operationName);
        }
        try {
            return await fnHttp();
        } catch (e) {
            if (!isTransportError(e)) {
                throw e;
            }
            invalidateModeCache();
            mode = await resolveMode({ force: true });
            if (mode === "db") {
                throw offlineOnly(operationName);
            }
            return await fnHttp();
        }
    }

    return {
        resolveMode,

        async health() {
            return execHttpOrDb(() => http.health(), () => db.health());
        },

        async getDomains() {
            return execHttpOrDb(() => http.getDomains(), () => db.getDomains());
        },

        async getRoutes() {
            return execHttpOrDb(() => http.getRoutes(), () => db.getRoutes());
        },

        async reserve(body) {
            return execHttpOrDb(() => http.reserve(body), () => db.reserve(body));
        },

        async release(subdomain, baseDomain) {
            return execHttpOrDb(() => http.release(subdomain, baseDomain), () => db.release(subdomain, baseDomain));
        },

        async putDomains(body) {
            return execHttpOrDb(() => http.putDomains(body), () => db.putDomains(body));
        },

        async getDdns() {
            return execHttpOrDb(() => http.getDdns(), () => db.getDdns());
        },

        /** @param {Record<string, unknown>} body */
        async putDdns(body) {
            return execHttpOrDb(() => http.putDdns(body), () => db.putDdns(body));
        },

        async deleteDdns() {
            return execHttpOrDb(() => http.deleteDdns(), () => db.deleteDdns());
        },

        /** @param {string} [jobId] */
        async postDdnsSync(jobId) {
            return execHttpOnly("postDdnsSync", () => http.postDdnsSync(jobId));
        },

        async getNetwork() {
            return execHttpOnly("getNetwork", () => http.getNetwork());
        },

        async scanPorts(body) {
            return execHttpOnly("scanPorts", () => http.scanPorts(body));
        },

        async killProcess(port) {
            return execHttpOnly("killProcess", () => http.killProcess(port));
        }
    };
}
