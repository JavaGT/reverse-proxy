/**
 * Opens SQLite at the repository default path, merges `meta.server_settings` with built-in defaults,
 * and syncs onto `process.env` (legacy names). Import `./bootstrapEnv.mjs` before this module in
 * `server.mjs` so `.env` is loaded first; `TLS_CERT_DIR` / `MANAGEMENT_SESSION_SECRET` apply when SQLite
 * omits those keys.
 */

import { SqlitePersistence } from "../infrastructure/persistence/SqlitePersistence.mjs";
import { applyServerSettingsToProcessEnv } from "./serverSettingsRegistry.mjs";

/** Fixed path relative to the process working directory (no environment variables). */
export const DEFAULT_SQLITE_DB_PATH = "./reverse-proxy.db";

function bootstrapServerSettingsFromDisk() {
    try {
        const persistence = new SqlitePersistence(DEFAULT_SQLITE_DB_PATH);
        applyServerSettingsToProcessEnv(persistence.getServerSettings());
    } catch (err) {
        console.warn(`[config] Could not load server_settings from ${DEFAULT_SQLITE_DB_PATH}: ${err?.message || err}`);
        applyServerSettingsToProcessEnv({});
    }
}

bootstrapServerSettingsFromDisk();

/**
 * Re-apply SQLite `server_settings` + defaults into `process.env` (call after saving settings via API).
 * @param {import("../infrastructure/persistence/SqlitePersistence.mjs").SqlitePersistence} persistence
 */
export function reapplyServerSettingsFromPersistence(persistence) {
    applyServerSettingsToProcessEnv(persistence.getServerSettings());
}
