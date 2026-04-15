import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqlitePersistence } from "../../src/infrastructure/persistence/SqlitePersistence.mjs";

test("getDdnsLastRun round-trip via saveDdnsLastRun", () => {
    const dbPath = path.join(os.tmpdir(), `rp-ddns-last-run-${Date.now()}.db`);
    try {
        const p = new SqlitePersistence(dbPath);
        assert.strictEqual(p.getDdnsLastRun(), null);

        const row = {
            at: "2026-04-15T12:00:00.000Z",
            outcome: "success",
            detail: "2 update(s)",
            skippedBecause: null
        };
        p.saveDdnsLastRun(row);
        const got = p.getDdnsLastRun();
        assert.deepStrictEqual(got, row);
    } finally {
        try {
            fs.unlinkSync(dbPath);
        } catch {
            /* ignore */
        }
    }
});

test("clearDdnsSettings removes ddns_last_run", () => {
    const dbPath = path.join(os.tmpdir(), `rp-ddns-clear-${Date.now()}.db`);
    try {
        const p = new SqlitePersistence(dbPath);
        p.saveDdnsLastRun({
            at: "2026-04-15T12:00:00.000Z",
            outcome: "skipped",
            detail: "Public IP unchanged",
            skippedBecause: "ip_unchanged"
        });
        p.saveDdnsSettings({ enabled: false, porkbunApiKey: "k", porkbunSecretKey: "s" });
        p.clearDdnsSettings();
        assert.strictEqual(p.getDdnsLastRun(), null);
        assert.strictEqual(p.getDdnsSettings(), null);
    } finally {
        try {
            fs.unlinkSync(dbPath);
        } catch {
            /* ignore */
        }
    }
});

test("getDdnsLastRun rejects invalid outcome", () => {
    const dbPath = path.join(os.tmpdir(), `rp-ddns-invalid-${Date.now()}.db`);
    try {
        const p = new SqlitePersistence(dbPath);
        p.getDatabaseSync().prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('ddns_last_run', ?)`).run(
            JSON.stringify({ at: "x", outcome: "nope", detail: "", skippedBecause: null })
        );
        assert.strictEqual(p.getDdnsLastRun(), null);
    } finally {
        try {
            fs.unlinkSync(dbPath);
        } catch {
            /* ignore */
        }
    }
});
