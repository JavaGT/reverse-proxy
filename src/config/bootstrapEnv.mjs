/**
 * Load `.env` from the current working directory before SQLite `server_settings` merge.
 * Node 20.6+ / 22+: `process.loadEnvFile()` (does not throw if the file is missing).
 */
if (typeof process.loadEnvFile === "function") {
    try {
        process.loadEnvFile();
    } catch {
        /* ignore */
    }
}
