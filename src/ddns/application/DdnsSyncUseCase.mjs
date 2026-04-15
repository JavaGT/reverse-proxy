/**
 * Application layer: orchestrates IP detection, cache, and Porkbun updates across one or more zones.
 */
export class DdnsSyncUseCase {
    constructor({ dnsProvider, ipLookup, ipCache, syncService, logger, matchNote }) {
        this.dnsProvider = dnsProvider;
        this.ipLookup = ipLookup;
        this.ipCache = ipCache;
        this.syncService = syncService;
        this.logger = logger;
        this.matchNote = matchNote;
    }

    /**
     * @param {string[]} domains - Apex zones to sync (from stored DDNS explicit list or registry apex list)
     * @returns {Promise<{ outcome: 'success' | 'skipped', detail: string, skippedBecause: string | null }>}
     */
    async execute(domains) {
        const list = domains?.length ? domains : [];
        if (list.length === 0) {
            this.logger.warn({ event: "ddns_no_domains" }, "DDNS: no domains configured; skipping");
            return { outcome: "skipped", detail: "No apex zones configured", skippedBecause: "no_domains" };
        }

        this.logger.info({ event: "ddns_sync_start", domains: list }, "--- DDNS sync ---");

        try {
            const currentIp = await this.ipLookup.getPublicIps();
            this.logger.info({ event: "ddns_ips", ...currentIp.toJSON() }, "Detected public IPs");

            if (!currentIp.hasAtLeastOne) {
                this.logger.error({ event: "ddns_no_public_ip" }, "No public IPv4 or IPv6 detected; aborting DDNS");
                return {
                    outcome: "skipped",
                    detail: "No public IPv4 or IPv6 detected",
                    skippedBecause: "no_public_ip"
                };
            }

            const cachedIp = await this.ipCache.read();
            if (cachedIp && cachedIp.equals(currentIp)) {
                this.logger.info({ event: "ddns_ip_unchanged" }, "Public IP unchanged; skipping DNS updates");
                return { outcome: "skipped", detail: "Public IP unchanged", skippedBecause: "ip_unchanged" };
            }

            let updateCount = 0;
            for (const domain of list) {
                this.logger.info({ event: "ddns_fetch_records", domain }, `Fetching DNS records for ${domain}`);
                const dnsRecords = await this.dnsProvider.getRecords(domain);

                const updates = this.syncService.findOutdatedRecords(dnsRecords, currentIp, this.matchNote);

                if (updates.length === 0) {
                    this.logger.info({ event: "ddns_no_updates", domain }, `No tracked records need update for ${domain}`);
                    continue;
                }

                for (const { record, newIp } of updates) {
                    this.logger.info(
                        { event: "ddns_edit", domain, name: record.name, type: record.type },
                        `Updating ${record.type} ${record.name}: ${record.content} -> ${newIp}`
                    );
                    await this.dnsProvider.editRecord(domain, record, newIp);
                    updateCount++;
                }
            }

            await this.ipCache.save(currentIp);
            this.logger.info({ event: "ddns_complete", updateCount }, `DDNS sync completed (${updateCount} update(s))`);
            return {
                outcome: "success",
                detail: `${updateCount} update(s)`,
                skippedBecause: null
            };
        } catch (error) {
            this.logger.error({ event: "ddns_failed", error: error.message }, "DDNS sync failed");
            throw error;
        }
    }
}
