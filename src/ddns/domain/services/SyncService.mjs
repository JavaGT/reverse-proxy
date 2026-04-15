/**
 * Pure domain logic: which DNS rows need updating for DDNS.
 */
export class SyncService {
    /**
     * @param {import("../models/DnsRecord.mjs").DnsRecord[]} records
     * @param {import("../models/PublicIp.mjs").PublicIp} publicIp
     * @param {string} matchNote
     * @returns {Array<{ record: import("../models/DnsRecord.mjs").DnsRecord, newIp: string }>}
     */
    findOutdatedRecords(records, publicIp, matchNote) {
        const updates = [];

        const trackedRecords = records.filter(
            record => record.isTaggedWith(matchNote) && (record.isIpv4 || record.isIpv6)
        );

        for (const record of trackedRecords) {
            const targetIp = record.isIpv4 ? publicIp.ipv4 : publicIp.ipv6;

            if (!targetIp) continue;

            if (!record.matchesIp(targetIp)) {
                updates.push({
                    record,
                    newIp: targetIp
                });
            }
        }

        return updates;
    }
}
