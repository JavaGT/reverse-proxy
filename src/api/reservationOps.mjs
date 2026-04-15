/**
 * Shared reservation parsing and conflict copy for POST /api/v1/reserve (single + batch).
 */

/**
 * @param {Record<string, unknown>} body
 */
export function parseReservationTargets(body) {
    let reservationTargets = body.targets;
    if (!reservationTargets) {
        if (body.ports) reservationTargets = body.ports;
        else if (body.port !== undefined && body.port !== null) reservationTargets = [body.port];
        else if (body.target) reservationTargets = [body.target];
    }
    return reservationTargets;
}

/**
 * @param {import("../domain/RouteRegistry.mjs").RouteRegistry} registry
 */
export function reserveWithRegistryOutcome(registry, subdomain, baseDomain, normalizedOptions, reservationTargets) {
    if (typeof reservationTargets[0] === "number") {
        return registry.reserveWithOutcome(subdomain, reservationTargets, normalizedOptions, baseDomain);
    }
    return registry.reserveUrlTargetsWithOutcome(subdomain, reservationTargets, normalizedOptions, baseDomain);
}

/**
 * @param {{ host: string, reason: string }} outcome
 */
export function subdomainConflictMessage(outcome) {
    if (outcome.reason === "reserved_host") {
        return `${outcome.host} is reserved for the management interface`;
    }
    return `${outcome.host} is already in use by another mapping; override is not allowed while the service is healthy`;
}
