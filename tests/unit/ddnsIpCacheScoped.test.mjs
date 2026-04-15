import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqlitePersistence } from "../../src/infrastructure/persistence/SqlitePersistence.mjs";
import { SqliteIpCache } from "../../src/ddns/infrastructure/adapters/SqliteIpCache.mjs";
import { PublicIp } from "../../src/ddns/domain/models/PublicIp.mjs";

test("SqliteIpCache uses distinct meta keys per job id", async () => {
    const dbPath = path.join(os.tmpdir(), `rp-ddns-ip-${Date.now()}.db`);
    try {
        const p = new SqlitePersistence(dbPath);
        const db = p.getDatabaseSync();
        const a = new SqliteIpCache(db, "job-a");
        const b = new SqliteIpCache(db, "job-b");
        await a.save(new PublicIp({ ipv4: "1.1.1.1", ipv6: null }));
        await b.save(new PublicIp({ ipv4: "2.2.2.2", ipv6: null }));
        const ra = await a.read();
        const rb = await b.read();
        assert.strictEqual(ra?.ipv4, "1.1.1.1");
        assert.strictEqual(rb?.ipv4, "2.2.2.2");
    } finally {
        try {
            fs.unlinkSync(dbPath);
        } catch {
            /* ignore */
        }
    }
});
