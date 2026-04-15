import test from "node:test";
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDbClient } from "../src/dbClient.mjs";

test("createDbClient reserve and release round-trip on SQLite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rp-client-"));
    const dbPath = join(dir, "t.db");
    const env = { ROOT_DOMAINS: "example.com" };

    const c = createDbClient({ dbPath, env });
    const r0 = await c.reserve({ subdomain: "app", baseDomain: "example.com", port: 9001 });
    assert.strictEqual(r0.data.host, "app.example.com");

    const routes = await c.getRoutes();
    const found = routes.data.some(r => r.host === "app.example.com");
    assert.ok(found, "route listed");

    const rel = await c.release("app", "example.com");
    assert.strictEqual(rel.data.host, "app.example.com");

    const routes2 = await c.getRoutes();
    assert.ok(!routes2.data.some(r => r.host === "app.example.com"));
});

test("createDbClient domains get includes primary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rp-client-"));
    const dbPath = join(dir, "t2.db");
    const env = { ROOT_DOMAINS: "example.org,example.com" };

    const c = createDbClient({ dbPath, env, defaultRootDomains: "example.com" });
    const d = await c.getDomains();
    assert.ok(d.data.apexDomains.includes("example.com") || d.data.apexDomains.includes("example.org"));
});
