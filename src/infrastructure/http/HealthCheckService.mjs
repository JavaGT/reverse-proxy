/**
 * SRP: Periodically checks the health of upstream targets (native fetch: http and https).
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
        const targetsToCheck = new Map();

        for (const route of routes) {
            const path = route.options?.healthPath;
            if (!path) continue;

            for (const target of route.targets) {
                const key = `${target.url}${path}`;
                if (!targetsToCheck.has(key)) {
                    targetsToCheck.set(key, { baseUrl: target.url, path });
                }
            }
        }

        const checks = Array.from(targetsToCheck.values()).map(({ baseUrl, path }) =>
            this.#checkTarget(baseUrl, path)
        );
        await Promise.all(checks);
    }

    async #checkTarget(baseUrl, healthPath) {
        let probeUrl;
        try {
            probeUrl = new URL(healthPath, baseUrl).href;
        } catch {
            this.#logger.debug({ event: "health_check_bad_url", baseUrl, healthPath }, "Invalid health probe URL");
            this.#updateRegistry(baseUrl, false);
            return;
        }

        try {
            const res = await fetch(probeUrl, {
                method: "GET",
                redirect: "manual",
                signal: AbortSignal.timeout(5000)
            });
            await res.arrayBuffer();

            const code = res.status;
            const isHealthy = code >= 200 && code < 400;
            this.#updateRegistry(baseUrl, isHealthy);
        } catch (err) {
            this.#logger.debug(
                { event: "health_check_error", baseUrl, healthPath, error: err.message },
                "Health check failed"
            );
            this.#updateRegistry(baseUrl, false);
        }
    }

    #updateRegistry(targetUrl, isHealthy) {
        const changed = this.#registry.updateTargetHealth(targetUrl, isHealthy);
        if (changed) {
            this.#logger.warn({ target: targetUrl, healthy: isHealthy }, `Health status changed for ${targetUrl}`);
        }
    }
}
