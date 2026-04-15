import { DnsRecord } from "../../domain/models/DnsRecord.mjs";
import { splitSldTld } from "./splitDomain.mjs";

const PROD = "https://api.namecheap.com/xml.response";
const SANDBOX = "https://api.sandbox.namecheap.com/xml.response";

/** Namecheap XML API (domains.dns.getHosts / setHosts). */
export class NamecheapDnsProvider {
    /**
     * @param {{ job: object, logger: object }} opts
     */
    constructor({ job, logger }) {
        this.logger = logger;
        this.#job = job;
        const c = job.credentials || {};
        this.#c = c;
        this.#matchNote = String(job.matchNote ?? "").trim();
        const sn = Array.isArray(c.syncRecordNames) && c.syncRecordNames.length
            ? c.syncRecordNames.map(x => String(x).trim().toLowerCase())
            : ["@"];
        this.#syncNames = new Set(sn);
    }

    /** @type {object} */
    #job;
    /** @type {object} */
    #c;
    /** @type {string} */
    #matchNote;
    /** @type {Set<string>} */
    #syncNames;

    #baseUrl() {
        return this.#c.sandbox ? SANDBOX : PROD;
    }

    #commonParams() {
        const p = new URLSearchParams();
        p.set("ApiUser", this.#c.apiUser);
        p.set("ApiKey", this.#c.apiKey);
        p.set("UserName", this.#c.apiUser);
        p.set("ClientIp", this.#c.clientIp);
        return p;
    }

    /**
     * @param {string} command
     * @param {Record<string, string>} extra
     */
    async #getXml(command, extra) {
        const p = this.#commonParams();
        p.set("Command", command);
        for (const [k, v] of Object.entries(extra)) {
            p.set(k, v);
        }
        const url = `${this.#baseUrl()}?${p.toString()}`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Namecheap HTTP ${res.status} ${res.statusText}`);
        }
        return res.text();
    }

    /** @param {string} xml */
    #assertOk(xml) {
        if (!/Status="OK"/i.test(xml)) {
            throw new Error(`Namecheap API error: ${xml.slice(0, 512)}`);
        }
    }

    /** @param {string} chunk */
    #parseAttrs(chunk) {
        const o = {};
        const attrRe = /(\w+)="([^"]*)"/g;
        let m;
        while ((m = attrRe.exec(chunk)) !== null) {
            o[m[1]] = m[2];
        }
        return o;
    }

    /**
     * @param {string} shortName
     * @param {string} domain
     */
    #fqdnFor(shortName, domain) {
        const n = (shortName || "@").toLowerCase();
        if (n === "@" || n === "") return domain;
        return `${n}.${domain}`;
    }

    /**
     * @param {string} domain - Apex zone
     */
    async getRecords(domain) {
        const { sld, tld } = splitSldTld(domain);
        const xml = await this.#getXml("namecheap.domains.dns.getHosts", { SLD: sld, TLD: tld });
        this.#assertOk(xml);
        const hosts = [];
        const re = /<host\s+([^/>]+)\/>/gi;
        let mm;
        while ((mm = re.exec(xml)) !== null) {
            hosts.push(this.#parseAttrs(mm[1]));
        }
        const out = [];
        for (const h of hosts) {
            const typ = (h.Type || "").toUpperCase();
            if (typ !== "A" && typ !== "AAAA") continue;
            const rawName = (h.Name === undefined || h.Name === null ? "@" : h.Name).toString();
            const shortCanon = rawName.toLowerCase() === "" ? "@" : rawName.toLowerCase();
            if (!this.#syncNames.has(shortCanon)) continue;
            const fqdn = this.#fqdnFor(rawName, domain);
            out.push(
                new DnsRecord({
                    id: h.HostId,
                    name: fqdn,
                    type: typ,
                    content: h.Address,
                    ttl: parseInt(String(h.TTL ?? "300"), 10) || 300,
                    prio: h.MXPref ? parseInt(String(h.MXPref), 10) : undefined,
                    notes: this.#matchNote
                })
            );
        }
        return out;
    }

    /**
     * @param {string} domain
     * @param {import("../../domain/models/DnsRecord.mjs").DnsRecord} record
     * @param {string} content
     */
    async editRecord(domain, record, content) {
        const { sld, tld } = splitSldTld(domain);
        const xml = await this.#getXml("namecheap.domains.dns.getHosts", { SLD: sld, TLD: tld });
        this.#assertOk(xml);
        const hosts = [];
        const re = /<host\s+([^/>]+)\/>/gi;
        let mm;
        while ((mm = re.exec(xml)) !== null) {
            hosts.push(this.#parseAttrs(mm[1]));
        }
        const idx = hosts.findIndex(h => String(h.HostId) === String(record.id));
        if (idx === -1) {
            throw new Error(`Namecheap: HostId ${record.id} not found for setHosts`);
        }
        hosts[idx] = { ...hosts[idx], Address: content };

        const p = this.#commonParams();
        p.set("Command", "namecheap.domains.dns.setHosts");
        p.set("SLD", sld);
        p.set("TLD", tld);
        let i = 1;
        for (const h of hosts) {
            p.set(`HostName${i}`, h.Name ?? "");
            p.set(`RecordType${i}`, h.Type ?? "");
            p.set(`Address${i}`, h.Address ?? "");
            p.set(`TTL${i}`, h.TTL ?? "300");
            p.set(`MXPref${i}`, h.MXPref !== undefined && h.MXPref !== null && h.MXPref !== "" ? String(h.MXPref) : "");
            i++;
        }
        const url = `${this.#baseUrl()}?${p.toString()}`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Namecheap setHosts HTTP ${res.status}`);
        }
        const out = await res.text();
        this.#assertOk(out);
    }
}
