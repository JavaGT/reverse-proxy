/**
 * Loads `.env`, then applies sparse SQLite `server_settings` overrides onto `process.env`.
 * Import this module first in `server.mjs` before other app imports so `process.env` is complete.
 */

import { loadEnvFile } from "node:process";
import { SqlitePersistence } from "../infrastructure/persistence/SqlitePersistence.mjs";
import { applyServerSettingsToProcessEnv } from "./serverSettingsRegistry.mjs";

try {
    loadEnvFile(".env");
} catch (err) {
    if (err?.code !== "ENOENT") throw err;
}

const dbPath = process.env.SQLITE_DB_PATH || "./reverse-proxy.db";

try {
    const persistence = new SqlitePersistence(dbPath);
    const sparse = persistence.getServerSettings();
    applyServerSettingsToProcessEnv(sparse);
} catch (err) {
    console.warn(`[config] Could not merge server_settings from ${dbPath}: ${err?.message || err}`);
}

/**
 * Reload `.env` baseline and re-apply SQLite overrides (call after saving settings via API).
 * @param {import("../infrastructure/persistence/SqlitePersistence.mjs").SqlitePersistence} persistence
 */
export function reapplyServerSettingsFromPersistence(persistence) {
    try {
        loadEnvFile(".env");
    } catch (err) {
        if (err?.code !== "ENOENT") throw err;
    }
    applyServerSettingsToProcessEnv(persistence.getServerSettings());
}
