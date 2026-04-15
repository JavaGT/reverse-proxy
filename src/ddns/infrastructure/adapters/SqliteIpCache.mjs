import { PublicIp } from "../../domain/models/PublicIp.mjs";

const META_KEY = "ddns_public_ip";

/**
 * Persists last synced public IP in SQLite meta (shared DB with route persistence).
 */
export class SqliteIpCache {
    /** @param {import("node:sqlite").DatabaseSync} db */
    constructor(db) {
        this.#db = db;
    }

    /** @type {import("node:sqlite").DatabaseSync} */
    #db;

    async read() {
        const row = this.#db.prepare(`SELECT value FROM meta WHERE key = ?`).get(META_KEY);
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
        this.#db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(META_KEY, payload);
    }
}
