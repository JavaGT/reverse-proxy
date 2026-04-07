import fs from "node:fs";
import path from "node:path";

/**
 * SRP: Handles file-based route persistence.
 * Encapsulated: Uses private class fields and methods.
 */
export class FilePersistence {
    #filePath;

    constructor(filePath) {
        this.#filePath = filePath;
        this.#ensureDir(path.dirname(filePath));
    }

    /** Loads routes from the cache file. Returns empty array if file missing/invalid. */
    async load() {
        if (!fs.existsSync(this.#filePath)) {
            return [];
        }

        try {
            const data = fs.readFileSync(this.#filePath, "utf-8");
            const routes = JSON.parse(data);
            
            // Migration: Convert legacy 'target' string to 'targets' array
            return routes.map(route => {
                if (route.target && !route.targets) {
                    return {
                        ...route,
                        targets: [{ url: route.target, healthy: true }],
                        options: route.options || {}
                    };
                }
                return route;
            });
        } catch (err) {
            console.error(`Failed to load route cache: ${err.message}`);
            return [];
        }
    }

    /** Saves current persistent routes to disk atomically. */
    async save(routes) {
        try {
            const data = JSON.stringify(routes, null, 2);
            // Non-blocking write to temporary file then Rename for atomicity
            const tmpPath = `${this.#filePath}.tmp`;
            fs.writeFileSync(tmpPath, data);
            fs.renameSync(tmpPath, this.#filePath);
        } catch (err) {
            console.error(`Failed to save route cache: ${err.message}`);
        }
    }

    #ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}
