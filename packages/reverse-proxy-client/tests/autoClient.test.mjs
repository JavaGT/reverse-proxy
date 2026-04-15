import test from "node:test";
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAutoClient } from "../src/autoClient.mjs";

function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}

test("createAutoClient uses DB when health fetch fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rp-auto-"));
    const dbPath = join(dir, "db.sqlite");
    const fetch = async () => {
        throw new Error("connection refused");
    };

    const c = createAutoClient({
        baseUrl: "http://127.0.0.1:1",
        dbPath,
        env: { ROOT_DOMAINS: "example.com" },
        fetch
    });

    const mode = await c.resolveMode();
    assert.strictEqual(mode, "db");

    const h = await c.health();
    assert.strictEqual(h.data.source, "database");
});

test("createAutoClient re-probes after modeCacheTtlMs (DB then HTTP)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rp-auto-"));
    const dbPath = join(dir, "db2.sqlite");
    let healthCalls = 0;
    const fetch = async (url, init) => {
        const u = String(url);
        if (u.includes("/api/v1/health")) {
            healthCalls += 1;
            if (healthCalls === 1) {
                throw new Error("connection refused");
            }
            return jsonResponse({ data: { status: "OK" } });
        }
        if (u.includes("/api/v1/routes")) {
            return jsonResponse({ data: [] });
        }
        return jsonResponse({}, 404);
    };

    const c = createAutoClient({
        baseUrl: "http://127.0.0.1:9",
        dbPath,
        env: { ROOT_DOMAINS: "example.com" },
        fetch,
        modeCacheTtlMs: 30
    });

    assert.strictEqual(await c.resolveMode(), "db");
    await delay(45);
    assert.strictEqual(await c.resolveMode(), "http");
    assert.strictEqual(healthCalls, 2);
});

test("createAutoClient retries HTTP after transport error then succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rp-auto-"));
    const dbPath = join(dir, "db3.sqlite");
    let routesCalls = 0;
    const fetch = async url => {
        const u = String(url);
        if (u.includes("/api/v1/health")) {
            return jsonResponse({ data: { status: "OK" } });
        }
        if (u.includes("/api/v1/routes")) {
            routesCalls += 1;
            if (routesCalls === 1) {
                throw new Error("ECONNRESET");
            }
            return jsonResponse({ data: [] });
        }
        return jsonResponse({}, 404);
    };

    const c = createAutoClient({
        baseUrl: "http://127.0.0.1:9",
        dbPath,
        env: { ROOT_DOMAINS: "example.com" },
        fetch,
        modeCacheTtlMs: 60_000
    });

    const { data } = await c.getRoutes();
    assert.ok(Array.isArray(data));
    assert.strictEqual(routesCalls, 2);
});
