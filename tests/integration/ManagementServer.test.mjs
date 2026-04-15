import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ManagementServer } from "../../src/infrastructure/http/ManagementServer.mjs";
import { ManagementController } from "../../src/api/ManagementController.mjs";
import { RouteRegistry } from "../../src/domain/RouteRegistry.mjs";
import { SqlitePersistence } from "../../src/infrastructure/persistence/SqlitePersistence.mjs";

const mockLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {}
};

const mockPersistence = {
    save: async () => {},
    saveRootDomainConfig: async () => {},
    getRootDomainConfig: () => null,
    load: async () => ({ routes: [], manualOverrides: {}, rootDomainConfig: null }),
    getDdnsSettings: () => null,
    saveDdnsSettings() {},
    clearDdnsSettings() {},
    getDdnsLastRun: () => null,
    saveDdnsLastRun() {},
    getServerSettings: () => ({}),
    saveServerSettingsPartial() {}
};

process.env.MANAGEMENT_AUTH_DATA_DIR = path.join(os.tmpdir(), `rp-mgmt-auth-int-${process.pid}`);
process.env.MANAGEMENT_AUTO_PUBLIC_EGRESS_IP = "0";

function firstNonLoopbackIpv4() {
    for (const infos of Object.values(os.networkInterfaces())) {
        for (const info of infos || []) {
            if (
                info.family === "IPv4" &&
                info.internal === false &&
                typeof info.address === "string" &&
                !info.address.startsWith("127.")
            ) {
                return info.address;
            }
        }
    }
    return null;
}

test("ManagementServer should serve /llms.txt with instructions", async (t) => {
    // 1. Setup
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        // 2. Start server
        const port = await server.start();
        const url = `http://127.0.0.1:${port}/llms.txt`;

        // 3. Fetch /llms.txt
        const response = await fetch(url);
        const text = await response.text();

        // 4. Assert
        assert.strictEqual(response.status, 200, "Should return 200 OK");
        assert.ok(text.includes("# LLM Instructions"), "Should contain the title");
        assert.ok(text.includes("example.com"), "Should include the root domain");
        assert.ok(text.includes("POST /api/v1/reserve"), "Should include the reservation endpoint");
        assert.ok(text.includes("@javagt/reverse-proxy-client"), "Should document the npm client package");
    } finally {
        // 5. Cleanup
        await server.stop();
    }
});

test("ManagementServer /llms.txt documents express-easy-auth for mutating routes", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const response = await fetch(`http://127.0.0.1:${port}/llms.txt`);
        const text = await response.text();

        assert.strictEqual(response.status, 200);
        assert.ok(text.includes("@javagt/express-easy-auth"), "Should mention express-easy-auth");
        assert.ok(text.includes("/api/v1/auth"), "Should point at auth routes");
    } finally {
        await server.stop();
    }
});

test("ManagementServer should serve OpenAPI YAML", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const response = await fetch(`http://127.0.0.1:${port}/openapi.yaml`);
        const text = await response.text();

        assert.strictEqual(response.status, 200);
        assert.ok(text.includes("openapi: 3.0.3"));
        assert.ok(text.includes("example.com"));

        const v1 = await fetch(`http://127.0.0.1:${port}/api/v1/openapi.yaml`).then(r => r.text());
        assert.ok(v1.includes("/api/v1/scan"));
        assert.ok(v1.includes("/api/v1/ddns"));
        assert.ok(v1.includes("/api/v1/ddns/sync"));
        assert.ok(v1.includes("/api/v1/accounts"));
        assert.ok(v1.includes("/api/v1/settings"));
    } finally {
        await server.stop();
    }
});

test("ManagementServer should serve ddns.html management page", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const response = await fetch(`http://127.0.0.1:${port}/ddns.html`);
        const text = await response.text();
        assert.strictEqual(response.status, 200);
        assert.ok(text.includes("rp-ddns-panel"), "Should include DDNS custom element");
        assert.ok(text.includes("rp-mgmt-header"), "Should include app chrome web component (nav links render client-side)");
    } finally {
        await server.stop();
    }
});

test("GET /api/v1/settings returns settings envelope", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/settings`, {
            headers: { Accept: "application/json" }
        });
        assert.strictEqual(res.status, 200);
        const j = await res.json();
        assert.ok(j.data?.settings && typeof j.data.settings === "object");
        assert.ok(Array.isArray(j.data?.bootstrapEnvKeys));
    } finally {
        await server.stop();
    }
});

test("ManagementServer should serve settings.html page", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const response = await fetch(`http://127.0.0.1:${port}/settings.html`);
        const text = await response.text();
        assert.strictEqual(response.status, 200);
        assert.ok(text.includes("mgmt-app.mjs"));
        assert.ok(text.includes("rp-settings-app"));
    } finally {
        await server.stop();
    }
});

test("ManagementServer should serve accounts.html management page", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const response = await fetch(`http://127.0.0.1:${port}/accounts.html`);
        const text = await response.text();
        assert.strictEqual(response.status, 200);
        assert.ok(text.includes("mgmt-app.mjs"), "Should load management app bundle");
        assert.ok(text.includes("rp-accounts-app"), "Should mount accounts web component");
    } finally {
        await server.stop();
    }
});

test("GET /api/v1/accounts on localhost returns account list envelope", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/accounts`, {
            headers: { Accept: "application/json" }
        });
        assert.strictEqual(res.status, 200);
        const j = await res.json();
        assert.ok(Array.isArray(j.data?.accounts), "data.accounts should be an array");
    } finally {
        await server.stop();
    }
});

test("DELETE /api/v1/accounts/:id returns 404 for unknown user", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/accounts/00000000-0000-4000-8000-000000000000`, {
            method: "DELETE",
            headers: { Accept: "application/json" }
        });
        assert.strictEqual(res.status, 404);
    } finally {
        await server.stop();
    }
});

test("ManagementServer should serve shared isValidApexFqdn module for the management UI", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const response = await fetch(`http://127.0.0.1:${port}/isValidApexFqdn.mjs`);
        const text = await response.text();
        assert.strictEqual(response.status, 200);
        assert.ok(
            text.includes("export function isValidApexFQDN"),
            "Should expose the same module the Node server imports"
        );
        assert.ok(
            response.headers.get("content-type")?.includes("javascript"),
            "Should be served as JavaScript"
        );
    } finally {
        await server.stop();
    }
});

test("JSON 404 responses include error.resolution", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/no-such-route`, {
            headers: { Accept: "application/json" }
        });
        assert.strictEqual(res.status, 404);
        const json = await res.json();
        assert.strictEqual(json.error?.code, "NOT_FOUND");
        assert.ok(typeof json.error?.resolution === "string" && json.error.resolution.length > 10);
    } finally {
        await server.stop();
    }
});

test("ManagementServer GET /api/v1/status matches health", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const [health, status] = await Promise.all([
            fetch(`http://127.0.0.1:${port}/api/v1/health`).then(r => r.json()),
            fetch(`http://127.0.0.1:${port}/api/v1/status`).then(r => r.json())
        ]);
        assert.deepStrictEqual(health, status);
        assert.strictEqual(health.data.status, "OK");
    } finally {
        await server.stop();
    }
});

test("GET /api/v1/domains returns apex list", async () => {
    const registry = new RouteRegistry("alpha.test", { additionalRootDomains: ["beta.test"] });
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "alpha.test", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/domains`).then(r => r.json());
        assert.deepStrictEqual(res.data.apexDomains.sort(), ["alpha.test", "beta.test"].sort());
        assert.strictEqual(res.data.primary, "alpha.test");
    } finally {
        await server.stop();
    }
});

test("GET /api/v1/ddns returns read-only Porkbun summary from SQLite row (no API secrets)", async () => {
    const ddnsRow = {
        enabled: true,
        porkbunApiKey: "must-not-leak",
        porkbunSecretKey: "also-secret",
        domainMode: "explicit",
        domains: ["ddns.example", "other.example"],
        matchNote: "tag:test-ddns",
        intervalMs: 120000,
        ipLookupTimeoutMs: 8000,
        ipv4Services: ["https://api4.ipify.org"],
        ipv6Services: ["https://api6.ipify.org"],
        porkbunApiBaseUrl: "https://api.porkbun.com/api/json/v3"
    };
    const persistence = {
        ...mockPersistence,
        getDdnsSettings: () => ddnsRow
    };
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, persistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const json = await fetch(`http://127.0.0.1:${port}/api/v1/ddns`).then(r => r.json());

        assert.strictEqual(json.data.enabled, true);
        assert.strictEqual(json.data.credentialsConfigured, true);
        assert.strictEqual(json.data.provider, "porkbun");
        assert.strictEqual(json.data.domainListSource, "STORED_EXPLICIT");
        assert.deepStrictEqual(json.data.domains, ["ddns.example", "other.example"]);
        assert.strictEqual(json.data.matchNote, "tag:test-ddns");
        assert.strictEqual(json.data.intervalMs, 120000);
        assert.strictEqual(json.data.schedulerState, "running");
        assert.strictEqual(json.data.schedulerWouldRun, true);
        assert.strictEqual(json.data.cachedPublicIp, null);
        assert.strictEqual(json.data.lastRun, null);
        assert.strictEqual(json.data.configSource, "sqlite");
        assert.strictEqual(json.data.configInvalid, false);
        assert.ok(Array.isArray(json.data.ipv4Services));
        assert.strictEqual(json.data.ipv4Services.length, 1);
        assert.ok(json.data.porkbunApiBaseUrl.includes("porkbun"));

        const raw = JSON.stringify(json);
        assert.ok(!raw.includes("must-not-leak"));
        assert.ok(!raw.includes("also-secret"));
    } finally {
        await server.stop();
    }
});

test("GET /api/v1/ddns when no row returns unconfigured summary", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const json = await fetch(`http://127.0.0.1:${port}/api/v1/ddns`).then(r => r.json());
        assert.strictEqual(json.data.configSource, "none");
        assert.strictEqual(json.data.schedulerState, "not_configured");
        assert.strictEqual(json.data.schedulerWouldRun, false);
    } finally {
        await server.stop();
    }
});

test("GET /api/v1/network returns local addresses and DNS rows", async () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", 3000, {}, "example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/network`);
        assert.strictEqual(res.status, 200);
        const json = await res.json();
        assert.ok(Array.isArray(json.data.localAddresses));
        assert.ok(json.data.localAddresses.length >= 1);
        assert.ok(json.data.generatedAt);
        assert.ok(json.data.publicIp && "ipv4" in json.data.publicIp && "ipv6" in json.data.publicIp);
        assert.ok(json.data.publicIngressSelfCheck && typeof json.data.publicIngressSelfCheck.port === "number");
        assert.ok(Object.prototype.hasOwnProperty.call(json.data.publicIngressSelfCheck, "ipv4"));
        assert.ok(Object.prototype.hasOwnProperty.call(json.data.publicIngressSelfCheck, "ipv6"));
        assert.ok("cgnatNote" in json.data);
        assert.ok(Array.isArray(json.data.dns?.rows));
        const kinds = json.data.dns.rows.map(r => r.rowKind);
        assert.ok(kinds.includes("apex"));
        assert.ok(kinds.includes("wildcard"));
        assert.ok(!kinds.includes("route"));
        assert.ok(!json.data.dns.rows.some(r => r.displayName === "app.example.com"));
    } finally {
        await server.stop();
    }
});

test("PUT /api/v1/domains updates apex list on loopback without session", async () => {
    const registry = new RouteRegistry("old.test");
    let lastDomainConfig = null;
    const persistence = {
        save: async () => {},
        saveRootDomainConfig: async cfg => {
            lastDomainConfig = cfg;
        },
        getRootDomainConfig: () => lastDomainConfig,
        load: async () => ({ routes: [], manualOverrides: {}, rootDomainConfig: null }),
        getDdnsSettings: () => null,
        saveDdnsSettings() {},
        clearDdnsSettings() {}
    };
    const controller = new ManagementController(registry, persistence, mockLogger);
    const server = new ManagementServer("mgmt", "old.test", controller, mockLogger);

    try {
        const port = await server.start();
        const url = `http://127.0.0.1:${port}/api/v1/domains`;
        const body = JSON.stringify({ apexDomains: ["solo.test"] });
        const res = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body
        });
        const json = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(json.data.primary, "solo.test");
    } finally {
        await server.stop();
    }
});

test("PUT /api/v1/domains persists dnsConsole shape", async () => {
    const registry = new RouteRegistry("a.example");
    let lastDomainConfig = null;
    const persistence = {
        save: async () => {},
        saveRootDomainConfig: async cfg => {
            lastDomainConfig = cfg;
        },
        getRootDomainConfig: () => lastDomainConfig,
        load: async () => ({ routes: [], manualOverrides: {}, rootDomainConfig: null }),
        getDdnsSettings: () => null,
        saveDdnsSettings() {},
        clearDdnsSettings() {}
    };
    const controller = new ManagementController(registry, persistence, mockLogger);
    const server = new ManagementServer("mgmt", "a.example", controller, mockLogger);

    try {
        const port = await server.start();
        const url = `http://127.0.0.1:${port}/api/v1/domains`;
        const put = body =>
            fetch(url, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            }).then(r => r.json().then(j => ({ status: r.status, json: j })));

        const r1 = await put({
            apexDomains: ["a.example", "b.example"],
            dnsConsole: {
                defaultProvider: "porkbun",
                byApex: { "a.example": "none", "b.example": "porkbun" }
            }
        });
        assert.strictEqual(r1.status, 200);
        assert.deepStrictEqual(lastDomainConfig?.apexDomains, ["a.example", "b.example"]);
        assert.deepStrictEqual(lastDomainConfig?.dnsConsole, {
            defaultProvider: "porkbun",
            byApex: { "a.example": null, "b.example": "porkbun" }
        });
        assert.strictEqual(r1.json.data.dnsConsole.defaultProvider, "porkbun");
        assert.strictEqual(r1.json.data.dnsConsoleLinks.length, 1);
        assert.strictEqual(r1.json.data.dnsConsoleLinks[0].apex, "b.example");

        const r2 = await put({
            apexDomains: ["a.example", "b.example"],
            dnsConsole: null
        });
        assert.strictEqual(r2.status, 200);
        assert.strictEqual(lastDomainConfig?.dnsConsole, null);
    } finally {
        await server.stop();
    }
});

test("POST /api/v1/reserve returns 400 when baseDomain is missing", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/reserve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subdomain: "x", port: 3000 })
        });
        const json = await res.json();
        assert.strictEqual(res.status, 400);
        assert.strictEqual(json.error?.message, "baseDomain is required");
        assert.ok(typeof json.error?.resolution === "string" && json.error.resolution.length > 10);
    } finally {
        await server.stop();
    }
});

test("POST /api/v1/reserve batch creates on multiple apex domains", async () => {
    const registry = new RouteRegistry("alpha.test", { additionalRootDomains: ["beta.test"] });
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "alpha.test", controller, mockLogger);

    try {
        const port = await server.start();
        const body = JSON.stringify({
            reservations: [
                { subdomain: "svc-a", baseDomain: "alpha.test", port: 3001 },
                { subdomain: "svc-b", baseDomain: "beta.test", port: 3002 }
            ]
        });
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/reserve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body
        });
        const json = await res.json();
        assert.strictEqual(res.status, 201);
        assert.strictEqual(json.data.batch, true);
        assert.strictEqual(json.data.results.length, 2);
        assert.strictEqual(json.data.results[0].data.host, "svc-a.alpha.test");
        assert.strictEqual(json.data.results[1].data.host, "svc-b.beta.test");
    } finally {
        await server.stop();
    }
});

test("POST /api/v1/reserve is idempotent (201 then 200)", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const body = JSON.stringify({
            subdomain: "pod",
            baseDomain: "example.com",
            port: 3000,
            options: { healthPath: "/health" }
        });
        const url = `http://127.0.0.1:${port}/api/v1/reserve`;
        const headers = { "Content-Type": "application/json" };

        const r1 = await fetch(url, { method: "POST", headers, body });
        const j1 = await r1.json();
        assert.strictEqual(r1.status, 201);
        assert.strictEqual(j1.data.publicUrl, "https://pod.example.com");

        const r2 = await fetch(url, { method: "POST", headers, body });
        const j2 = await r2.json();
        assert.strictEqual(r2.status, 200);
        assert.strictEqual(j2.data.host, j1.data.host);
    } finally {
        await server.stop();
    }
});

test("PUT and DELETE /api/v1/ddns persist in SQLite on loopback", async () => {
    const dbPath = path.join(os.tmpdir(), `rp-ddns-int-${Date.now()}.db`);
    const persistence = new SqlitePersistence(dbPath);
    const registry = new RouteRegistry("myapex.test");
    const controller = new ManagementController(registry, persistence, mockLogger);
    const server = new ManagementServer("mgmt", "myapex.test", controller, mockLogger);

    try {
        const port = await server.start();
        const base = `http://127.0.0.1:${port}/api/v1/ddns`;
        const headers = { "Content-Type": "application/json" };

        let r = await fetch(base, {
            method: "PUT",
            headers,
            body: JSON.stringify({
                enabled: true,
                porkbunApiKey: "a",
                porkbunSecretKey: "b",
                domainMode: "apex",
                matchNote: "note-x",
                intervalMs: 20_000,
                ipLookupTimeoutMs: 9000
            })
        });
        assert.strictEqual(r.status, 200);
        let j = await r.json();
        assert.strictEqual(j.data.configSource, "sqlite");
        assert.strictEqual(j.data.domainListSource, "STORED_APEX");
        assert.deepStrictEqual(j.data.domains, ["myapex.test"]);

        r = await fetch(base, { method: "DELETE" });
        assert.strictEqual(r.status, 200);
        j = await r.json();
        assert.strictEqual(j.data.configSource, "none");
        assert.strictEqual(j.data.schedulerState, "not_configured");
    } finally {
        await server.stop();
        try {
            fs.rmSync(dbPath, { force: true });
        } catch {
            /* ignore */
        }
    }
});

test("POST /api/v1/ddns/sync returns 400 when DDNS is not configured", async () => {
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const r = await fetch(`http://127.0.0.1:${port}/api/v1/ddns/sync`, { method: "POST" });
        assert.strictEqual(r.status, 400);
        const j = await r.json();
        assert.strictEqual(j.error?.code, "DDNS_NOT_CONFIGURED");
    } finally {
        await server.stop();
    }
});

test("POST /api/v1/ddns/sync returns 400 when DDNS is disabled in SQLite", async () => {
    const persistence = {
        ...mockPersistence,
        getDdnsSettings: () => ({
            enabled: false,
            porkbunApiKey: "a",
            porkbunSecretKey: "b",
            domainMode: "apex",
            matchNote: "m",
            intervalMs: 30_000,
            ipLookupTimeoutMs: 8000,
            ipv4Services: ["https://api4.ipify.org"],
            ipv6Services: ["https://api6.ipify.org"],
            porkbunApiBaseUrl: "https://api.porkbun.com/api/json/v3"
        })
    };
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, persistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const r = await fetch(`http://127.0.0.1:${port}/api/v1/ddns/sync`, { method: "POST" });
        assert.strictEqual(r.status, 400);
        const j = await r.json();
        assert.strictEqual(j.error?.code, "DDNS_SYNC_IDLE");
    } finally {
        await server.stop();
    }
});

test("PUT /api/v1/ddns returns 501 when persistence has no DDNS save support", async () => {
    const persistence = {
        save: async () => {},
        saveRootDomainConfig: async () => {},
        getRootDomainConfig: () => null,
        load: async () => ({ routes: [], manualOverrides: {}, rootDomainConfig: null }),
        getDdnsSettings: () => null
    };
    const registry = new RouteRegistry("x.test");
    const controller = new ManagementController(registry, persistence, mockLogger);
    const server = new ManagementServer("mgmt", "x.test", controller, mockLogger);

    try {
        const port = await server.start();
        const r = await fetch(`http://127.0.0.1:${port}/api/v1/ddns`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: false })
        });
        assert.strictEqual(r.status, 501);
    } finally {
        await server.stop();
    }
});

test("logical non-loopback client gets 401 for gated JSON without session", async () => {
    const prevTrust = process.env.MANAGEMENT_TRUST_PROXY;
    process.env.MANAGEMENT_TRUST_PROXY = "1";
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/domains`, {
            headers: {
                Accept: "application/json",
                "X-Forwarded-For": "203.0.113.10"
            }
        });
        assert.strictEqual(res.status, 401);
        const json = await res.json();
        assert.strictEqual(json.error?.code, "UNAUTHORIZED");
        assert.ok(typeof json.error?.resolution === "string" && json.error.resolution.length > 10);

        const login = await fetch(`http://127.0.0.1:${port}/login.html`, {
            headers: { "X-Forwarded-For": "203.0.113.10", Accept: "text/html" }
        });
        assert.strictEqual(login.status, 200);
        const html = await login.text();
        assert.ok(html.includes("Sign in"), "login page should load without prior session");

        const css = await fetch(`http://127.0.0.1:${port}/mgmt.css`, {
            headers: { "X-Forwarded-For": "203.0.113.10", Accept: "text/css" }
        });
        assert.strictEqual(css.status, 200);
        const body = await css.text();
        assert.ok(body.includes("--bg:"), "mgmt.css should be served without session");
    } finally {
        await server.stop();
        if (prevTrust === undefined) delete process.env.MANAGEMENT_TRUST_PROXY;
        else process.env.MANAGEMENT_TRUST_PROXY = prevTrust;
    }
});

test("GET /api/v1/health and /health are allowed without session (login.html local-operator probe)", async () => {
    const prevTrust = process.env.MANAGEMENT_TRUST_PROXY;
    process.env.MANAGEMENT_TRUST_PROXY = "1";
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const headers = {
            Accept: "application/json",
            "X-Forwarded-For": "203.0.113.10"
        };
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { headers });
        assert.strictEqual(res.status, 200);
        const json = await res.json();
        assert.strictEqual(json.data?.status, "OK");
        assert.notStrictEqual(res.headers.get("x-management-local-operator"), "1");

        const root = await fetch(`http://127.0.0.1:${port}/health`, { headers });
        assert.strictEqual(root.status, 200);
    } finally {
        await server.stop();
        if (prevTrust === undefined) delete process.env.MANAGEMENT_TRUST_PROXY;
        else process.env.MANAGEMENT_TRUST_PROXY = prevTrust;
    }
});

test("forwarded client IP matching this host bypasses session gate", async t => {
    const prevTrust = process.env.MANAGEMENT_TRUST_PROXY;
    process.env.MANAGEMENT_TRUST_PROXY = "1";
    const hostIp = firstNonLoopbackIpv4();
    if (!hostIp) {
        t.skip("no non-loopback IPv4 on this host");
        if (prevTrust === undefined) delete process.env.MANAGEMENT_TRUST_PROXY;
        else process.env.MANAGEMENT_TRUST_PROXY = prevTrust;
        return;
    }

    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/domains`, {
            headers: {
                Accept: "application/json",
                "X-Forwarded-For": hostIp
            }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get("x-management-local-operator"), "1");

        const logout = await fetch(`http://127.0.0.1:${port}/api/v1/auth/logout`, {
            method: "POST",
            headers: { "X-Forwarded-For": hostIp }
        });
        assert.strictEqual(logout.status, 204);
    } finally {
        await server.stop();
        if (prevTrust === undefined) delete process.env.MANAGEMENT_TRUST_PROXY;
        else process.env.MANAGEMENT_TRUST_PROXY = prevTrust;
    }
});

test("X-Forwarded-For chain: a non-leftmost hop matching this host bypasses session gate", async t => {
    const prevTrust = process.env.MANAGEMENT_TRUST_PROXY;
    process.env.MANAGEMENT_TRUST_PROXY = "1";
    const hostIp = firstNonLoopbackIpv4();
    if (!hostIp) {
        t.skip("no non-loopback IPv4 on this host");
        if (prevTrust === undefined) delete process.env.MANAGEMENT_TRUST_PROXY;
        else process.env.MANAGEMENT_TRUST_PROXY = prevTrust;
        return;
    }

    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/domains`, {
            headers: {
                Accept: "application/json",
                "X-Forwarded-For": `203.0.113.50, ${hostIp}`
            }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get("x-management-local-operator"), "1");
    } finally {
        await server.stop();
        if (prevTrust === undefined) delete process.env.MANAGEMENT_TRUST_PROXY;
        else process.env.MANAGEMENT_TRUST_PROXY = prevTrust;
    }
});

test("ManagementServer stop clears public egress refresh interval", async () => {
    const origClear = global.clearInterval;
    let clearCount = 0;
    global.clearInterval = function (id) {
        clearCount++;
        return origClear(id);
    };
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);
    try {
        await server.start();
        await server.stop();
        assert.ok(clearCount >= 1, "stop() should clearInterval for the egress refresh timer");
    } finally {
        global.clearInterval = origClear;
    }
});

test("GET /api/v1/registration-secret from localhost works without session (local operator)", async () => {
    const prev = process.env.MANAGEMENT_REGISTRATION_SECRET;
    process.env.MANAGEMENT_REGISTRATION_SECRET = "invite-from-local-test";
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/registration-secret`, {
            headers: { Accept: "application/json" }
        });
        assert.strictEqual(res.status, 200);
        const j = await res.json();
        assert.strictEqual(j.data?.configured, true);
        assert.strictEqual(j.data?.secret, "invite-from-local-test");
    } finally {
        await server.stop();
        if (prev === undefined) delete process.env.MANAGEMENT_REGISTRATION_SECRET;
        else process.env.MANAGEMENT_REGISTRATION_SECRET = prev;
    }
});

test("POST /api/v1/auth/register without MANAGEMENT_REGISTRATION_SECRET returns 503", async () => {
    const prev = process.env.MANAGEMENT_REGISTRATION_SECRET;
    delete process.env.MANAGEMENT_REGISTRATION_SECRET;
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                username: "z",
                email: "z@test.integration",
                password: "password123",
                registrationSecret: "x"
            })
        });
        assert.strictEqual(res.status, 503);
        const j = await res.json();
        assert.strictEqual(j.error?.code, "NOT_CONFIGURED");
    } finally {
        await server.stop();
        if (prev === undefined) delete process.env.MANAGEMENT_REGISTRATION_SECRET;
        else process.env.MANAGEMENT_REGISTRATION_SECRET = prev;
    }
});

test("POST /api/v1/auth/register requires valid registrationSecret when configured", async () => {
    const prev = process.env.MANAGEMENT_REGISTRATION_SECRET;
    process.env.MANAGEMENT_REGISTRATION_SECRET = "test-invite-secret-1";
    const registry = new RouteRegistry("example.com");
    const controller = new ManagementController(registry, mockPersistence, mockLogger);
    const server = new ManagementServer("mgmt", "example.com", controller, mockLogger);

    try {
        const port = await server.start();
        const bad = await fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                username: "a0",
                email: "a0@test.integration",
                password: "password123"
            })
        });
        assert.strictEqual(bad.status, 403);

        const bad2 = await fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                username: "a0b",
                email: "a0b@test.integration",
                password: "password123",
                registrationSecret: "wrong"
            })
        });
        assert.strictEqual(bad2.status, 403);

        const u = `u${Date.now()}`;
        const ok = await fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                username: u,
                email: `${u}@test.integration`,
                password: "password123",
                registrationSecret: "test-invite-secret-1"
            })
        });
        assert.ok(ok.status === 201 || ok.status === 409, `unexpected ${ok.status}`);
    } finally {
        await server.stop();
        if (prev === undefined) delete process.env.MANAGEMENT_REGISTRATION_SECRET;
        else process.env.MANAGEMENT_REGISTRATION_SECRET = prev;
    }
});
