import { PublicIp } from "../../domain/models/PublicIp.mjs";
import { LEGACY_V1_JOB_ID, sanitizeDdnsJobIdForMetaKey } from "../../ddnsDocument.mjs";

const LEGACY_META_KEY = "ddns_public_ip";

/**
 * Persists last synced public IP in SQLite meta (shared DB with route persistence).
 * Scoped per DDNS job when `jobId` is set (avoids skipping updates for another provider/account).
 */
export class SqliteIpCache {
    /**
     * @param {import("node:sqlite").DatabaseSync} db
     * @param {string} [jobId] - When omitted, uses legacy single-key storage (and reads migrate from legacy).
     */
    constructor(db, jobId) {
        this.#db = db;
        this.#jobId = jobId != null ? String(jobId).trim() : null;
        this.#selectMeta = db.prepare(`SELECT value FROM meta WHERE key = ?`);
        this.#upsertMeta = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);
    }

    /** @type {import("node:sqlite").DatabaseSync} */
    #db;
    /** @type {string | null} */
    #jobId;
    /** @type {import("node:sqlite").StatementSync} */
    #selectMeta;
    /** @type {import("node:sqlite").StatementSync} */
    #upsertMeta;

    #metaKey() {
        if (!this.#jobId || this.#jobId === LEGACY_V1_JOB_ID) {
            return `ddns_public_ip:${sanitizeDdnsJobIdForMetaKey(LEGACY_V1_JOB_ID)}`;
        }
        return `ddns_public_ip:${sanitizeDdnsJobIdForMetaKey(this.#jobId)}`;
    }

    async read() {
        const key = this.#metaKey();
        let row = this.#selectMeta.get(key);
        if (!row?.value && key !== LEGACY_META_KEY && (!this.#jobId || this.#jobId === LEGACY_V1_JOB_ID)) {
            row = this.#selectMeta.get(LEGACY_META_KEY);
        }
        if (!row?.value) return null;
        try {
            const saved = JSON.parse(row.value);
            return new PublicIp({ ipv4: saved.ipv4, ipv6: saved.ipv6 });
        } catch {
            return null;
        }
    }

    async save(publicIp) {
        const payload = JSON.stringify(publicIp.toJSON());
        const key = this.#metaKey();
        this.#upsertMeta.run(key, payload);
    }
}
