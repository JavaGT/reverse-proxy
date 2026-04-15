import { DnsRecord } from "../../domain/models/DnsRecord.mjs";

/** Porkbun JSON API v3 (DNS edit/retrieve). */
export class PorkbunDnsProvider {
    constructor({ apiKey, secretKey, apiBaseUrl, logger }) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.apiBaseUrl = apiBaseUrl;
        this.logger = logger;
    }

    toPorkbunName(recordName, domain) {
        if (recordName === domain) return "";
        const suffix = `.${domain}`;
        if (recordName.endsWith(suffix)) return recordName.slice(0, -suffix.length);
        return recordName;
    }

    async post(path, body) {
        const response = await fetch(`${this.apiBaseUrl}/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                apikey: this.apiKey,
                secretapikey: this.secretKey,
                ...body
            })
        });

        if (!response.ok) {
            throw new Error(`Porkbun API request failed: ${response.status} ${response.statusText} at ${path}`);
        }

        const data = await response.json();
        if (data.status !== "SUCCESS") {
            throw new Error(`Porkbun API error: ${JSON.stringify(data)} at ${path}`);
        }

        return data;
    }

    async getRecords(domain) {
        const data = await this.post(`dns/retrieve/${domain}`, {});
        return (data.records || []).map(
            r =>
                new DnsRecord({
                    id: r.id,
                    name: r.name,
                    type: r.type,
                    content: r.content,
                    ttl: r.ttl,
                    prio: r.prio,
                    notes: r.notes
                })
        );
    }

    async editRecord(domain, record, content) {
        await this.post(`dns/edit/${domain}/${record.id}`, {
            name: this.toPorkbunName(record.name, domain),
            type: record.type,
            content,
            ttl: record.ttl,
            prio: record.prio
        });
    }
}
