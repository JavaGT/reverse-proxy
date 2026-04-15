import test from "node:test";
import assert from "node:assert";
import { SyncService } from "../../src/ddns/domain/services/SyncService.mjs";
import { DdnsSyncUseCase } from "../../src/ddns/application/DdnsSyncUseCase.mjs";
import { PublicIp } from "../../src/ddns/domain/models/PublicIp.mjs";
import { DnsRecord } from "../../src/ddns/domain/models/DnsRecord.mjs";

test("SyncService finds outdated tagged A record", () => {
    const svc = new SyncService();
    const rec = new DnsRecord({
        id: "1",
        name: "dyn.example.com",
        type: "A",
        content: "9.9.9.9",
        notes: "tag:ddns"
    });
    const updates = svc.findOutdatedRecords([rec], new PublicIp({ ipv4: "1.1.1.1" }), "tag:ddns");
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].newIp, "1.1.1.1");
});

test("DdnsSyncUseCase updates Porkbun when IP differs from cache", async () => {
    const logger = { info: () => {}, error: () => {}, warn: () => {} };
    let edited = false;
    const dnsProvider = {
        getRecords: async () => [
            new DnsRecord({
                id: "r1",
                name: "example.com",
                type: "A",
                content: "old",
                notes: "m"
            })
        ],
        editRecord: async () => {
            edited = true;
        }
    };
    const ipLookup = {
        getPublicIps: async () => new PublicIp({ ipv4: "new" })
    };
    const ipCache = {
        read: async () => new PublicIp({ ipv4: "old" }),
        save: async () => {}
    };
    const useCase = new DdnsSyncUseCase({
        dnsProvider,
        ipLookup,
        ipCache,
        syncService: new SyncService(),
        logger,
        matchNote: "m"
    });

    await useCase.execute(["example.com"]);
    assert.strictEqual(edited, true);
});
