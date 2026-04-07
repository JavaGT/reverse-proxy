/**
 * SRP: Pure in-memory route registry with Load Balancing support.
 * Encapsulated: Uses private class fields and methods (ES2022).
 */
export class RouteRegistry {
    #rootDomain;
    #persistentRoutes = new Map();
    #ephemeralRoutes = new Map();
    #reservedHosts;
    #counters = new Map();

    constructor(rootDomain, reservedHosts = []) {
        this.#rootDomain = rootDomain;
        this.#reservedHosts = new Set(reservedHosts);
    }

    /** Returns only the persistent routes for saving to disk. */
    getPersistentRoutes() {
        return Array.from(this.#persistentRoutes, ([host, route]) => ({ 
            host, 
            targets: route.targets,
            options: route.options 
        }));
    }

    /** Returns all registered routes as an array of { host, targets, type, options } objects. */
    getAllRoutes() {
        const routes = [];
        for (const [host, route] of this.#persistentRoutes) {
            if (host) routes.push({ host, targets: route.targets, type: "persistent", options: route.options });
        }
        for (const [host, route] of this.#ephemeralRoutes) {
            if (host) routes.push({ host, targets: route.targets, type: "ephemeral", options: route.options });
        }
        return routes;
    }

    /** 
     * Returns a specific target URL using Round-Robin selection from healthy targets.
     * Note: Returns null if no healthy targets found.
     */
    getTarget(host) {
        const route = this.#ephemeralRoutes.get(host) ?? this.#persistentRoutes.get(host);
        if (!route || !route.targets || route.targets.length === 0) return null;

        const healthyTargets = route.targets.filter(t => t.healthy !== false);
        if (healthyTargets.length === 0) return null;

        if (healthyTargets.length === 1) return healthyTargets[0].url;

        // Round Robin selection
        let count = this.#counters.get(host) || 0;
        const target = healthyTargets[count % healthyTargets.length];
        this.#counters.set(host, (count + 1) % healthyTargets.length);

        return target.url;
    }

    /** Returns the full route object { targets, options } if found. */
    getRoute(host) {
        return this.#ephemeralRoutes.get(host) ?? this.#persistentRoutes.get(host);
    }

    registerEphemeralRoute(host, targetUrl, options = {}) {
        const targets = [{ url: targetUrl, healthy: true }];
        this.#ephemeralRoutes.set(host, { targets, options });
        return { host, targets, options };
    }

    registerPersistentRoute(host, targets, options = {}) {
        if (this.#reservedHosts.has(host)) {
            throw new Error(`${host} is reserved for the management interface`);
        }

        const normalizedTargets = Array.isArray(targets) 
            ? targets.map(t => typeof t === "string" ? { url: t, healthy: true } : { ...t, healthy: t.healthy ?? true })
            : [{ url: targets, healthy: true }];

        this.#persistentRoutes.set(host, { targets: normalizedTargets, options });
        return { host, targets: normalizedTargets, options };
    }

    /**
     * Reserve a subdomain → multiple localhost targets mapping.
     */
    reserve(subdomain, portOrPorts, options = {}) {
        const normalizedSubdomain = this.#validateSubdomain(subdomain);
        const host = `${normalizedSubdomain}.${this.#rootDomain}`;

        if (this.#persistentRoutes.has(host) || this.#ephemeralRoutes.has(host)) {
            throw new Error(`${host} is already reserved`);
        }

        const ports = Array.isArray(portOrPorts) ? portOrPorts : [portOrPorts];
        const targets = ports.map(port => ({
            url: `http://localhost:${this.#validatePort(port)}`,
            healthy: true
        }));

        return this.registerPersistentRoute(host, targets, options);
    }

    /**
     * Remove a previously reserved subdomain route.
     */
    release(subdomain) {
        const normalizedSubdomain = this.#validateSubdomain(subdomain);
        const host = `${normalizedSubdomain}.${this.#rootDomain}`;

        if (this.#reservedHosts.has(host)) {
            throw new Error(`${host} is reserved for the management interface and cannot be released`);
        }

        const route = this.#persistentRoutes.get(host);
        if (!route) return null;

        this.#persistentRoutes.delete(host);
        this.#counters.delete(host);
        return { host, targets: route.targets };
    }

    /** Used by persistence layer to hydrate the registry from disk. */
    hydrate(routes) {
        this.#persistentRoutes.clear();
        this.#counters.clear();
        for (const { host, targets, target, options = {} } of routes) {
            if (this.#reservedHosts.has(host)) continue;

            // Handle legacy format (single target string) or new target object format
            let normalizedTargets = [];
            if (targets) {
              normalizedTargets = targets;
            } else if (target) {
              normalizedTargets = [{ url: target, healthy: true }];
            }

            this.#persistentRoutes.set(host, { targets: normalizedTargets, options });
        }
    }

    /** Updates the health status of a specific target URL across all routes. */
    updateTargetHealth(targetUrl, isHealthy) {
        let changed = false;
        for (const route of this.#persistentRoutes.values()) {
            for (const target of route.targets) {
                if (target.url === targetUrl && target.healthy !== isHealthy) {
                    target.healthy = isHealthy;
                    changed = true;
                }
            }
        }
        return changed;
    }

    #validateSubdomain(subdomain) {
        const normalized = String(subdomain ?? "").trim().toLowerCase();

        if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
            throw new Error("subdomain must be a single DNS label using letters, numbers, or hyphens");
        }

        return normalized;
    }

    #validatePort(port) {
        const normalized = Number(port);

        if (!Number.isInteger(normalized) || normalized < 1 || normalized > 65535) {
            throw new Error("port must be an integer between 1 and 65535");
        }

        return normalized;
    }
}
