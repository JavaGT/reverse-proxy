/**
 * Value Object representing a Porkbun DNS record row.
 */
export class DnsRecord {
    constructor({ id, name, type, content, ttl, prio, notes } = {}) {
        this.id = id;
        this.name = name;
        this.type = type;
        this.content = content;
        this.ttl = ttl;
        this.prio = prio;
        this.notes = notes;
        Object.freeze(this);
    }

    get isIpv4() {
        return this.type === "A";
    }

    get isIpv6() {
        return this.type === "AAAA";
    }

    matchesIp(ip) {
        return this.content === ip;
    }

    isTaggedWith(note) {
        return this.notes === note;
    }
}
