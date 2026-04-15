/** Typed validation errors from {@link RouteRegistry} reserve/release paths (stable `code` + optional `details`). */

export class BaseDomainRequiredError extends Error {
    /** @param {string} [message] */
    constructor(message = "baseDomain is required") {
        super(message);
        this.name = "BaseDomainRequiredError";
        this.code = "BASE_DOMAIN_REQUIRED";
    }
}

export class BaseDomainNotConfiguredError extends Error {
    /**
     * @param {string} requested - Raw or normalized requested apex (for message)
     * @param {readonly string[]} allowed - Configured apex domains
     */
    constructor(requested, allowed) {
        const sorted = [...allowed].sort();
        super(`baseDomain "${requested}" is not configured; allowed: ${sorted.join(", ")}`);
        this.name = "BaseDomainNotConfiguredError";
        this.code = "BASE_DOMAIN_NOT_CONFIGURED";
        this.details = { requested: String(requested), allowed: sorted };
    }
}

export class SubdomainValidationError extends Error {
    constructor() {
        super("subdomain must be a single DNS label using letters, numbers, or hyphens");
        this.name = "SubdomainValidationError";
        this.code = "SUBDOMAIN_INVALID";
    }
}

export class PortValidationError extends Error {
    constructor() {
        super("port must be an integer between 1 and 65535");
        this.name = "PortValidationError";
        this.code = "PORT_INVALID";
    }
}
