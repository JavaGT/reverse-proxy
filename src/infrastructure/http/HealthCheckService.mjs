import http from "node:http";

/**
 * SRP: Periodically checks the health of upstream targets.
 * Decoupled: Updates the RouteRegistry with the results.
 */
export class HealthCheckService {
    #registry;
    #logger;
    #intervalMs;
    #timer = null;

    constructor(registry, logger, intervalMs = 30_000) {
        this.#registry = registry;
        this.#logger = logger;
        this.#intervalMs = intervalMs;
    }

    start() {
        if (this.#timer) return;
        
        this.#logger.info({ intervalMs: this.#intervalMs }, "Health check service starting");
        
        // Initial check
        this.checkAll();
        
        this.#timer = setInterval(() => {
            this.checkAll();
        }, this.#intervalMs);
    }

    stop() {
        if (this.#timer) {
            clearInterval(this.#timer);
            this.#timer = null;
        }
    }

    async checkAll() {
        const routes = this.#registry.getAllRoutes();
        const uniqueTargets = new Set();
        
        for (const route of routes) {
            for (const target of route.targets) {
                uniqueTargets.add(target.url);
            }
        }

        const checks = Array.from(uniqueTargets).map(url => this.#checkTarget(url));
        await Promise.all(checks);
    }

    async #checkTarget(url) {
        return new Promise((resolve) => {
            const parsed = new URL(url);
            const options = {
                hostname: parsed.hostname,
                port: parseInt(parsed.port || "80", 10),
                path: "/health", // Standard health endpoint
                method: "GET",
                timeout: 5000,
            };

            const req = http.request(options, (res) => {
                const isHealthy = res.statusCode >= 200 && res.statusCode < 400;
                this.#updateRegistry(url, isHealthy);
                resolve();
            });

            req.on("error", () => {
                this.#updateRegistry(url, false);
                resolve();
            });

            req.on("timeout", () => {
                req.destroy();
                this.#updateRegistry(url, false);
                resolve();
            });

            req.end();
        });
    }

    #updateRegistry(url, isHealthy) {
        const changed = this.#registry.updateTargetHealth(url, isHealthy);
        if (changed) {
            this.#logger.warn({ target: url, healthy: isHealthy }, `Health status changed for ${url}`);
        }
    }
}
