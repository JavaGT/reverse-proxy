import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SRP: SQLite-backed route persistence (node:sqlite).
 * Encapsulated: schema init, legacy JSON migration, meta for manual overrides.
 */
export class SqlitePersistence {
    #db;
    #legacyJsonPath;

    /**
     * @param {string} dbPath - Path to SQLite file
     * @param {{ legacyRouteCacheFile?: string }} [options]
     */
    constructor(dbPath, options = {}) {
        this.#legacyJsonPath = options.legacyRouteCacheFile || null;
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.#db = new DatabaseSync(dbPath);
        this.#ensureSchema();
        this.#migrateFromLegacyJsonIfNeeded();
    }

    /** @returns {import("node:sqlite").DatabaseSync} */
    getDatabaseSync() {
        return this.#db;
    }

    /** Loads routes and manual overrides (JSON-serializable route rows + manual map). */
    async load() {
        const manualOverrides = this.#readManualOverrides();

        const stmt = this.#db.prepare(
            `SELECT host, targets_json, options_json FROM routes WHERE manual = 0 ORDER BY host`
        );
        const rows = stmt.all();
        const routes = [];
        for (const row of rows) {
            try {
                routes.push({
                    host: row.host,
                    targets: JSON.parse(row.targets_json),
                    options: JSON.parse(row.options_json)
                });
            } catch {
                console.warn(`SQLite load: skipping corrupt route row for host ${row.host ?? "(unknown)"}`);
            }
        }

        return { routes, manualOverrides, rootDomainConfig: this.#readRootDomainConfig() };
    }

    /**
     * Full apex + optional DNS console provider config (SQLite `meta.root_domains`).
     * @returns {{ apexDomains: string[], dnsConsole?: object | null } | null}
     */
    getRootDomainConfig() {
        return this.#readRootDomainConfig();
    }

    /**
     * Porkbun DDNS row from `meta.ddns` (may contain API secrets). Null if unset.
     * @returns {object | null}
     */
    getDdnsSettings() {
        const row = this.#db.prepare(`SELECT value FROM meta WHERE key = 'ddns'`).get();
        if (!row?.value) return null;
        try {
            const parsed = JSON.parse(row.value);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    /**
     * @param {object} settings - Normalized DDNS document (includes keys when provided)
     */
    saveDdnsSettings(settings) {
        this.#db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('ddns', ?)`).run(JSON.stringify(settings));
    }

    clearDdnsSettings() {
        this.#db.prepare(`DELETE FROM meta WHERE key = 'ddns'`).run();
    }

    /**
     * @param {{ apexDomains: string[], dnsConsole?: object | null }} config
     */
    async saveRootDomainConfig(config) {
        const { apexDomains, dnsConsole } = config;
        const payload = { apexDomains };
        if (dnsConsole !== undefined) {
            payload.dnsConsole = dnsConsole;
        }
        const value = JSON.stringify(payload);
        this.#db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('root_domains', ?)`).run(value);
    }

    /** Persists non-manual routes; preserves manual_overrides meta. */
    async save(routes) {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
            this.#db.prepare(`DELETE FROM routes WHERE manual = 0`).run();
            const insert = this.#db.prepare(
                `INSERT INTO routes (host, targets_json, options_json, manual) VALUES (?, ?, ?, 0)`
            );
            for (const route of routes) {
                insert.run(route.host, JSON.stringify(route.targets), JSON.stringify(route.options || {}));
            }
            this.#db.exec("COMMIT");
        } catch (err) {
            try {
                this.#db.exec("ROLLBACK");
            } catch {
                /* ignore */
            }
            throw err;
        }
    }

    #ensureSchema() {
        this.#db.exec(`
            CREATE TABLE IF NOT EXISTS routes (
                host TEXT PRIMARY KEY,
                targets_json TEXT NOT NULL,
                options_json TEXT NOT NULL,
                manual INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
    }

    #readManualOverrides() {
        const row = this.#db.prepare(`SELECT value FROM meta WHERE key = 'manual_overrides'`).get();
        if (!row?.value) return {};
        try {
            return JSON.parse(row.value);
        } catch {
            return {};
        }
    }

    /** @returns {{ apexDomains: string[], dnsConsole?: object | null } | null} */
    #readRootDomainConfig() {
        const row = this.#db.prepare(`SELECT value FROM meta WHERE key = 'root_domains'`).get();
        if (!row?.value) return null;
        try {
            const parsed = JSON.parse(row.value);
            if (!parsed || typeof parsed !== "object") return null;
            if (!Array.isArray(parsed.apexDomains) || parsed.apexDomains.length === 0) return null;
            const apexDomains = parsed.apexDomains.map(d => String(d).trim().toLowerCase()).filter(Boolean);
            let dnsConsole = undefined;
            if (Object.prototype.hasOwnProperty.call(parsed, "dnsConsole")) {
                const v = parsed.dnsConsole;
                if (v === null) dnsConsole = null;
                else if (typeof v === "object" && !Array.isArray(v)) dnsConsole = v;
                else dnsConsole = null;
            }
            return { apexDomains, dnsConsole };
        } catch {
            /* ignore */
        }
        return null;
    }

    #migrateFromLegacyJsonIfNeeded() {
        const migrated = this.#db.prepare(`SELECT value FROM meta WHERE key = 'migrated_from_json'`).get();
        if (migrated?.value === "1") return;

        const legacyPath = this.#legacyJsonPath;
        if (!legacyPath || !fs.existsSync(legacyPath)) {
            this.#db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated_from_json', '1')`).run();
            return;
        }

        try {
            const raw = fs.readFileSync(legacyPath, "utf-8");
            const parsed = JSON.parse(raw);
            let routes = [];
            let manualOverrides = {};

            if (Array.isArray(parsed)) {
                routes = parsed;
            } else if (parsed && typeof parsed === "object") {
                manualOverrides = parsed.manualOverrides || {};
                routes = Array.isArray(parsed.routes) ? parsed.routes : [];
            }

            const migratedRoutes = routes.map(route => {
                if (route.target && !route.targets) {
                    return {
                        ...route,
                        targets: [{ url: route.target, healthy: true }],
                        options: route.options || {}
                    };
                }
                return route;
            });

            this.#db.exec("BEGIN IMMEDIATE");
            try {
                for (const route of migratedRoutes) {
                    if (!route.host) continue;
                    this.#db
                        .prepare(
                            `INSERT OR REPLACE INTO routes (host, targets_json, options_json, manual) VALUES (?, ?, ?, 0)`
                        )
                        .run(route.host, JSON.stringify(route.targets), JSON.stringify(route.options || {}));
                }
                if (Object.keys(manualOverrides).length > 0) {
                    this.#db
                        .prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('manual_overrides', ?)`)
                        .run(JSON.stringify(manualOverrides));
                }
                this.#db
                    .prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated_from_json', '1')`)
                    .run();
                this.#db.exec("COMMIT");
            } catch (e) {
                try {
                    this.#db.exec("ROLLBACK");
                } catch {
                    /* ignore */
                }
                throw e;
            }
        } catch (err) {
            console.error(`SQLite legacy migration failed: ${err.message}`);
        }
    }
}
