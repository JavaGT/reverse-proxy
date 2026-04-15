import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LEGACY_V1_JOB_ID } from "../../ddns/ddnsDocument.mjs";

/**
 * SRP: SQLite-backed route persistence (node:sqlite).
 * Encapsulated: schema init, meta for manual overrides.
 */
export class SqlitePersistence {
    #db;

    /**
     * @param {string} dbPath - Path to SQLite file
     */
    constructor(dbPath) {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.#db = new DatabaseSync(dbPath);
        this.#ensureSchema();
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
        this.#db.prepare(`DELETE FROM meta WHERE key = 'ddns_last_run'`).run();
        this.#db.prepare(`DELETE FROM meta WHERE key LIKE 'ddns_public_ip%'`).run();
    }

    /**
     * Public IPv4/6 last written by DDNS sync (`meta.ddns_public_ip*`). Used for management
     * same-machine detection when hairpin presents this WAN but outbound ipify differs or lags.
     * @returns {string[]}
     */
    getDdnsPublicIpAddressesForLocalOperatorHint() {
        const rows = this.#db
            .prepare(`SELECT value FROM meta WHERE key = 'ddns_public_ip' OR key LIKE 'ddns_public_ip:%'`)
            .all();
        const out = [];
        const seen = new Set();
        for (const row of rows) {
            if (!row?.value) continue;
            try {
                const p = JSON.parse(row.value);
                if (!p || typeof p !== "object") continue;
                for (const key of ["ipv4", "ipv6"]) {
                    const v = p[key];
                    if (typeof v !== "string") continue;
                    const t = v.trim();
                    if (!t || seen.has(t)) continue;
                    seen.add(t);
                    out.push(t);
                }
            } catch {
                /* ignore */
            }
        }
        return out;
    }

    /**
     * Last DDNS sync telemetry (`meta.ddns_last_run`), keyed by job id.
     * @returns {{ jobs: Record<string, { at: string, outcome: string, detail: string, skippedBecause: string | null }> } | null}
     */
    getDdnsLastRun() {
        const row = this.#db.prepare(`SELECT value FROM meta WHERE key = 'ddns_last_run'`).get();
        if (!row?.value) return null;
        try {
            const parsed = JSON.parse(row.value);
            if (!parsed || typeof parsed !== "object") return null;
            if (parsed.jobs && typeof parsed.jobs === "object" && !Array.isArray(parsed.jobs)) {
                return { jobs: /** @type {Record<string, object>} */ (parsed.jobs) };
            }
            const at = typeof parsed.at === "string" ? parsed.at : null;
            const outcome = typeof parsed.outcome === "string" ? parsed.outcome : null;
            const detail = typeof parsed.detail === "string" ? parsed.detail : "";
            if (!at || !outcome) return null;
            if (!["success", "skipped", "failed"].includes(outcome)) return null;
            const skippedBecause =
                parsed.skippedBecause === null || parsed.skippedBecause === undefined
                    ? null
                    : String(parsed.skippedBecause);
            return {
                jobs: {
                    [LEGACY_V1_JOB_ID]: { at, outcome, detail, skippedBecause }
                }
            };
        } catch {
            return null;
        }
    }

    /**
     * @param {{ at: string, outcome: string, detail: string, skippedBecause: string | null }} record
     */
    saveDdnsLastRun(record) {
        this.saveDdnsLastRunForJob(LEGACY_V1_JOB_ID, record);
    }

    /**
     * @param {string} jobId
     * @param {{ at: string, outcome: string, detail: string, skippedBecause: string | null }} record
     */
    saveDdnsLastRunForJob(jobId, record) {
        const detail = String(record.detail ?? "").slice(0, 512);
        const payload = {
            at: record.at,
            outcome: record.outcome,
            detail,
            skippedBecause: record.skippedBecause ?? null
        };
        const cur = this.getDdnsLastRun();
        const jobs = { ...(cur?.jobs ?? {}), [String(jobId).trim()]: payload };
        this.#db
            .prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('ddns_last_run', ?)`)
            .run(JSON.stringify({ jobs }));
    }

    /**
     * Sparse overrides for server settings merged with defaults (see `src/config/serverSettingsRegistry.mjs`).
     * @returns {Record<string, unknown>}
     */
    getServerSettings() {
        const row = this.#db.prepare(`SELECT value FROM meta WHERE key = 'server_settings'`).get();
        if (!row?.value) return {};
        try {
            const parsed = JSON.parse(row.value);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    /**
     * Merge partial settings; use `null` to remove a key (revert to built-in default on next apply).
     * @param {Record<string, unknown>} partial
     */
    saveServerSettingsPartial(partial) {
        const cur = this.getServerSettings();
        const next = { ...cur };
        for (const [k, v] of Object.entries(partial)) {
            if (v === null) {
                delete next[k];
            } else {
                next[k] = v;
            }
        }
        this.#db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('server_settings', ?)`).run(JSON.stringify(next));
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
}
