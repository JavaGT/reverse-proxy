/**
 * Value Object: detected public IPv4 / IPv6 addresses.
 */
export class PublicIp {
    constructor({ ipv4 = null, ipv6 = null } = {}) {
        this.ipv4 = ipv4;
        this.ipv6 = ipv6;
        Object.freeze(this);
    }

    equals(other) {
        if (!(other instanceof PublicIp)) return false;
        return this.ipv4 === other.ipv4 && this.ipv6 === other.ipv6;
    }

    get hasAtLeastOne() {
        return !!(this.ipv4 || this.ipv6);
    }

    toJSON() {
        return { ipv4: this.ipv4, ipv6: this.ipv6 };
    }
}
