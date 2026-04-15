import { normalizeReserveOptions } from "../shared/utils/ReserveOptions.mjs";

/**
 * SRP: Pure in-memory route registry with Load Balancing support.
 * Encapsulated: Uses private class fields and methods (ES2022).
 * Supports multiple apex domains (e.g. example.com + example.org).
 */
export class RouteRegistry {
    #primaryRootDomain;
    #rootDomains;
    #persistentRoutes = new Map();
    #ephemeralRoutes = new Map();
    #reservedHosts;
    #counters = new Map();
    /** @type {string | null} Ephemeral host for the management UI (so it can move when apex list changes). */
    #managementEphemeralHost = null;

    /**
     * @param {string} primaryRootDomain - Primary apex (first in ordered list; callers still pass baseDomain on reserve/release)
     * @param {string[] | { additionalRootDomains?: string[], reservedHosts?: string[] }} [reservedHostsOrOptions]
     *        Legacy: second arg is reservedHosts array. New: options object.
     */
    constructor(primaryRootDomain, reservedHostsOrOptions = []) {
        let reservedHosts = [];
        let additionalRootDomains = [];

        if (Array.isArray(reservedHostsOrOptions)) {
            reservedHosts = reservedHostsOrOptions;
        } else if (reservedHostsOrOptions && typeof reservedHostsOrOptions === "object") {
            reservedHosts = reservedHostsOrOptions.reservedHosts ?? [];
            additionalRootDomains = reservedHostsOrOptions.additionalRootDomains ?? [];
        }

        this.#primaryRootDomain = String(primaryRootDomain ?? "")
            .trim()
            .toLowerCase();
        this.#rootDomains = new Set(
            [this.#primaryRootDomain, ...additionalRootDomains.map(d => String(d).trim().toLowerCase())].filter(Boolean)
        );
        this.#reservedHosts = new Set(reservedHosts);
    }

    get rootDomain() {
        return this.#primaryRootDomain;
    }

    /** @returns {string[]} */
    getRootDomains() {
        return Array.from(this.#rootDomains).sort();
    }

    get hasMultipleRootDomains() {
        return this.#rootDomains.size > 1;
    }

    /** Hostname of the management ephemeral route, if registered. */
    get managementInterfaceHost() {
        return this.#managementEphemeralHost;
    }

    /**
     * Replace configured apex domains (first entry is primary). Validates existing routes fit the new list.
     * @param {string[]} orderedApexes
     */
    setRootDomains(orderedApexes) {
        const list = [];
        const seen = new Set();
        for (const d of orderedApexes) {
            const x = String(d ?? "")
                .trim()
                .toLowerCase();
            if (!x || seen.has(x)) continue;
            seen.add(x);
            list.push(x);
        }
        if (list.length === 0) {
            throw new Error("At least one apex domain is required");
        }
        const set = new Set(list);
        this.#assertRoutesCompatibleWithRootSet(set);
        this.#primaryRootDomain = list[0];
        this.#rootDomains = set;
    }

    /**
     * Registers the management UI/API as an ephemeral route and tracks its host for domain changes.
     * @param {string} host
     * @param {string} targetUrl
     */
    registerManagementInterface(host, targetUrl) {
        const h = String(host ?? "").toLowerCase();
        if (this.#managementEphemeralHost && this.#managementEphemeralHost !== h) {
            this.#ephemeralRoutes.delete(this.#managementEphemeralHost);
            this.#counters.delete(this.#managementEphemeralHost);
        }
        this.#managementEphemeralHost = h;
        this.registerEphemeralRoute(h, targetUrl);
    }

    #assertRoutesCompatibleWithRootSet(apexSet) {
        for (const [routeHost] of this.#persistentRoutes) {
            const apex = this.#apexForHostAgainstRootSet(routeHost, apexSet);
            if (!apex || !apexSet.has(apex)) {
                throw new Error(
                    `Route "${routeHost}" is not under any listed apex; remove or migrate it before changing domains`
                );
            }
        }
        for (const [routeHost] of this.#ephemeralRoutes) {
            if (routeHost === this.#managementEphemeralHost) continue;
            const apex = this.#apexForHostAgainstRootSet(routeHost, apexSet);
            if (!apex || !apexSet.has(apex)) {
                throw new Error(
                    `Ephemeral route "${routeHost}" is not under any listed apex; remove it before changing domains`
                );
            }
        }
    }

    #apexForHostAgainstRootSet(host, apexSet) {
        const h = String(host ?? "").toLowerCase();
        const sorted = [...apexSet].sort((a, b) => b.length - a.length);
        for (const root of sorted) {
            if (h === root) return root;
            const suf = "." + root;
            if (h.endsWith(suf)) return root;
        }
        return null;
    }

    /**
     * Longest-match apex for a hostname (for public URLs / UI).
     * @param {string} host
     */
    baseDomainForHost(host) {
        const h = String(host ?? "").toLowerCase();
        const sorted = [...this.#rootDomains].sort((a, b) => b.length - a.length);
        for (const root of sorted) {
            if (h === root) return root;
            const suf = "." + root;
            if (h.endsWith(suf)) return root;
        }
        return this.#primaryRootDomain;
    }

    /** Returns only the persistent routes for saving to disk. */
    getPersistentRoutes() {
        return Array.from(this.#persistentRoutes, ([host, route]) => ({
            host,
            targets: route.targets.map(t => {
                const url = typeof t === "string" ? t : t.url;
                const healthy = typeof t === "string" ? true : (t.healthy ?? true);
                return { url, healthy };
            }),
            options: route.options
        })).filter(route => !route.options.manual);
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

    getTarget(host) {
        const route = this.#ephemeralRoutes.get(host) ?? this.#persistentRoutes.get(host);
        if (!route || !route.targets || route.targets.length === 0) return null;

        const healthyTargets = route.targets.filter(t => t.healthy !== false);
        if (healthyTargets.length === 0) return null;

        if (healthyTargets.length === 1) return healthyTargets[0].url;

        let count = this.#counters.get(host) || 0;
        const target = healthyTargets[count % healthyTargets.length];
        this.#counters.set(host, (count + 1) % healthyTargets.length);

        return target.url;
    }

    getRoute(host) {
        return this.#ephemeralRoutes.get(host) ?? this.#persistentRoutes.get(host);
    }

    registerEphemeralRoute(host, targetUrl, options = {}) {
        const targets = [{ url: targetUrl, healthy: true }];
        this.#ephemeralRoutes.set(host, { targets, options });
        return { host, targets, options };
    }

    putReservation(host, normalizedTargets, normalizedOptions) {
        if (this.#reservedHosts.has(host)) {
            return { outcome: "conflict", host, reason: "reserved_host" };
        }

        const existingRoute = this.#persistentRoutes.get(host) || this.#ephemeralRoutes.get(host);
        if (existingRoute && this.#sameReservation(existingRoute, normalizedTargets, normalizedOptions)) {
            return {
                outcome: "unchanged",
                data: { host, targets: existingRoute.targets, options: existingRoute.options }
            };
        }

        if (existingRoute) {
            const hasHealthCheck = !!existingRoute.options?.healthPath;
            const isUnhealthy = existingRoute.targets?.every(t => t.healthy === false);

            if (hasHealthCheck && !isUnhealthy) {
                return { outcome: "conflict", host, reason: "healthy_service_blocks_replace" };
            }
        }

        const targets = normalizedTargets.map(t =>
            typeof t === "string"
                ? { url: t, healthy: true }
                : { ...t, healthy: t.healthy ?? true }
        );

        this.#persistentRoutes.set(host, { targets, options: normalizedOptions });
        return { outcome: "created", data: { host, targets, options: normalizedOptions } };
    }

    registerPersistentRoute(host, targets, options = {}) {
        if (this.#reservedHosts.has(host)) {
            throw new Error(`${host} is reserved for the management interface`);
        }

        const normalizedTargets = Array.isArray(targets)
            ? targets.map(t => (typeof t === "string" ? { url: t, healthy: true } : { ...t, healthy: t.healthy ?? true }))
            : [{ url: targets, healthy: true }];

        if (options?.manual) {
            const merged = { ...normalizeReserveOptions(options), manual: true };
            this.#persistentRoutes.set(host, { targets: normalizedTargets, options: merged });
            return { host, targets: normalizedTargets, options: merged };
        }

        const normalizedOptions = normalizeReserveOptions(options);
        const r = this.putReservation(host, normalizedTargets, normalizedOptions);
        if (r.outcome === "conflict") {
            throw new Error(`${host} is already reserved by a healthy service. Override denied.`);
        }
        return r.data;
    }

    reserve(subdomain, portOrPorts, rawOptions = {}, baseDomain) {
        const normalizedOptions = normalizeReserveOptions(rawOptions);
        const r = this.reserveWithOutcome(subdomain, portOrPorts, normalizedOptions, baseDomain);
        if (r.outcome === "conflict") {
            throw new Error(`${r.host} is already reserved by a healthy service. Override denied.`);
        }
        return r.data;
    }

    /** @param {Record<string, unknown>} normalizedOptions */
    reserveWithOutcome(subdomain, portOrPorts, normalizedOptions, baseDomain) {
        const normalizedSubdomain = this.#validateSubdomain(subdomain);
        const apex = this.#resolveBaseDomain(baseDomain);
        const host = `${normalizedSubdomain}.${apex}`;

        const ports = Array.isArray(portOrPorts) ? portOrPorts : [portOrPorts];
        const targets = ports.map(port => ({
            url: `http://localhost:${this.#validatePort(port)}`,
            healthy: true
        }));

        return this.putReservation(host, targets, normalizedOptions);
    }

    reserveUrlTargetsWithOutcome(subdomain, reservationTargets, normalizedOptions, baseDomain) {
        const normalizedSubdomain = this.#validateSubdomain(subdomain);
        const apex = this.#resolveBaseDomain(baseDomain);
        const host = `${normalizedSubdomain}.${apex}`;
        const normalizedTargets = reservationTargets.map(t =>
            typeof t === "string" ? { url: t, healthy: true } : { ...t, healthy: t.healthy ?? true }
        );
        return this.putReservation(host, normalizedTargets, normalizedOptions);
    }

    /**
     * @param {string} subdomain - DNS label
     * @param {string} baseDomain - Apex FQDN (required)
     */
    release(subdomain, baseDomain) {
        const normalizedSubdomain = this.#validateSubdomain(subdomain);
        const apex = this.#resolveBaseDomain(baseDomain);
        const host = `${normalizedSubdomain}.${apex}`;

        if (this.#reservedHosts.has(host)) {
            throw new Error(`${host} is reserved for the management interface and cannot be released`);
        }

        const route = this.#persistentRoutes.get(host);
        if (!route) return null;

        this.#persistentRoutes.delete(host);
        this.#counters.delete(host);
        return { host, targets: route.targets };
    }

    hydrate(routes) {
        this.#persistentRoutes.clear();
        this.#counters.clear();
        for (const { host, targets, target, options = {} } of routes) {
            if (this.#reservedHosts.has(host)) continue;

            let normalizedTargets = [];
            if (targets) {
                normalizedTargets = targets;
            } else if (target) {
                normalizedTargets = [{ url: target, healthy: true }];
            }

            this.#persistentRoutes.set(host, { targets: normalizedTargets, options });
        }
    }

    updateTargetHealth(targetUrl, isHealthy) {
        const checkedAt = new Date().toISOString();
        let changed = false;
        const maps = [this.#persistentRoutes, this.#ephemeralRoutes];
        for (const m of maps) {
            for (const route of m.values()) {
                for (const target of route.targets) {
                    if (target.url !== targetUrl) continue;
                    target.healthCheckedAt = checkedAt;
                    if (target.healthy !== isHealthy) {
                        target.healthy = isHealthy;
                        changed = true;
                    }
                }
            }
        }
        return changed;
    }

    /** Apex must always be explicit (no implicit primary). */
    #resolveBaseDomain(requested) {
        if (requested == null || String(requested).trim() === "") {
            throw new Error("baseDomain is required");
        }

        const d = String(requested).trim().toLowerCase();
        if (!this.#rootDomains.has(d)) {
            throw new Error(
                `baseDomain "${requested}" is not configured; allowed: ${Array.from(this.#rootDomains).sort().join(", ")}`
            );
        }
        return d;
    }

    #sameReservation(existingRoute, incomingTargets, incomingOptions) {
        if (!this.#targetUrlsMatch(existingRoute.targets, incomingTargets)) {
            return false;
        }
        return this.#reserveOptionsKey(existingRoute.options) === this.#reserveOptionsKey(incomingOptions);
    }

    #targetUrlsMatch(a, b) {
        if (!a?.length || !b?.length || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            const ua = typeof a[i] === "string" ? a[i] : a[i].url;
            const ub = typeof b[i] === "string" ? b[i] : b[i].url;
            if (ua !== ub) return false;
        }
        return true;
    }

    #reserveOptionsKey(options) {
        const o = this.#comparableOptions(options);
        return JSON.stringify(o);
    }

    #comparableOptions(options) {
        if (!options || typeof options !== "object") return {};
        const x = {};
        if (options.healthPath) x.healthPath = options.healthPath;
        if (options.allowlist?.length) x.allowlist = [...options.allowlist].slice().sort();
        return x;
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
