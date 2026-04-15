import test from "node:test";
import assert from "node:assert";
import {
    buildDdnsPublicSummary,
    DEFAULT_IPV4_SERVICES,
    DEFAULT_PORKBUN_API_BASE_URL,
    getRuntimeDdnsTick,
    mergePutDdnsBody,
    parseStoredDdnsRow,
    resolveDomainsForJob,
    snapshotDdnsResolveContext
} from "../../src/ddns/ddnsConfigResolve.mjs";

function isValidApexFQDN(s) {
    const t = String(s).trim().toLowerCase();
    if (!t || t.length > 253) return false;
    const labels = t.split(".");
    for (const label of labels) {
        if (label.length < 1 || label.length > 63) return false;
        if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return false;
    }
    return true;
}

test("buildDdnsPublicSummary: sqlite row wins over unconfigured", () => {
    const stored = {
        enabled: true,
        porkbunApiKey: "k",
        porkbunSecretKey: "s",
        domainMode: "explicit",
        domains: ["z.test"],
        matchNote: "tag:ui",
        intervalMs: 111_111,
        ipLookupTimeoutMs: 7000,
        ipv4Services: ["https://api4.ipify.org"],
        ipv6Services: ["https://api6.ipify.org"],
        porkbunApiBaseUrl: DEFAULT_PORKBUN_API_BASE_URL
    };
    const s = buildDdnsPublicSummary({
        getApexDomains: () => ["ignored.test"],
        stored
    });
    assert.strictEqual(s.configSource, "sqlite");
    assert.strictEqual(s.enabled, true);
    assert.strictEqual(s.domainListSource, "STORED_EXPLICIT");
    assert.deepStrictEqual(s.domains, ["z.test"]);
    assert.strictEqual(s.matchNote, "tag:ui");
    assert.strictEqual(s.intervalMs, 111_111);
    assert.strictEqual(s.porkbunApiBaseUrl, DEFAULT_PORKBUN_API_BASE_URL);
    assert.strictEqual(s.ipv4Services.length, 1);
});

test("buildDdnsPublicSummary: no row is none / not_configured", () => {
    const s = buildDdnsPublicSummary({
        getApexDomains: () => ["a.test"],
        stored: null
    });
    assert.strictEqual(s.configSource, "none");
    assert.strictEqual(s.schedulerState, "not_configured");
    assert.strictEqual(s.domainListSource, "NONE");
    assert.deepStrictEqual(s.ipv4Services, [...DEFAULT_IPV4_SERVICES]);
});

test("snapshotDdnsResolveContext calls source getters once; jobs reuse snapshot", () => {
    let apexCalls = 0;
    let ctxCalls = 0;
    const snap = snapshotDdnsResolveContext(
        () => {
            apexCalls++;
            return ["a.example.com", "b.example.com"];
        },
        () => {
            ctxCalls++;
            return { dnsConsole: null, env: {} };
        }
    );
    const job = { domainMode: "apex", provider: "porkbun", domains: [] };
    resolveDomainsForJob(job, snap.getApexDomains, snap.getDnsConsoleContext);
    resolveDomainsForJob(job, snap.getApexDomains, snap.getDnsConsoleContext);
    assert.strictEqual(apexCalls, 1);
    assert.strictEqual(ctxCalls, 1);
});

test("getRuntimeDdnsTick: no SQLite row", () => {
    const tick = getRuntimeDdnsTick({
        persistence: { getDdnsSettings: () => null },
        getApexDomains: () => []
    });
    assert.strictEqual(tick.shouldRun, false);
    assert.strictEqual(tick.logReason, "ddns_not_configured");
});

test("getRuntimeDdnsTick apex mode filters to Porkbun DNS console apexes only", () => {
    const stored = {
        enabled: true,
        porkbunApiKey: "k",
        porkbunSecretKey: "s",
        domainMode: "apex",
        domains: [],
        matchNote: "m",
        intervalMs: 30_000,
        ipLookupTimeoutMs: 8000,
        ipv4Services: ["https://v4.ident.me"],
        ipv6Services: ["https://v6.ident.me"],
        porkbunApiBaseUrl: DEFAULT_PORKBUN_API_BASE_URL
    };
    const tick = getRuntimeDdnsTick({
        persistence: { getDdnsSettings: () => stored },
        getApexDomains: () => ["a.example", "b.example"],
        getDnsConsoleContext: () => ({
            dnsConsole: { defaultProvider: "porkbun", byApex: { "a.example": "none" } },
            env: {}
        })
    });
    assert.strictEqual(tick.shouldRun, true);
    assert.deepStrictEqual(tick.domains, ["b.example"]);
});

test("getRuntimeDdnsTick uses SQLite credentials and service lists", () => {
    const stored = {
        enabled: true,
        porkbunApiKey: "k",
        porkbunSecretKey: "s",
        domainMode: "explicit",
        domains: ["a.test"],
        matchNote: "m",
        intervalMs: 30_000,
        ipLookupTimeoutMs: 4000,
        ipv4Services: ["https://v4.ident.me"],
        ipv6Services: ["https://v6.ident.me"],
        porkbunApiBaseUrl: "https://api.porkbun.com/api/json/v3"
    };
    const tick = getRuntimeDdnsTick({
        persistence: { getDdnsSettings: () => stored },
        getApexDomains: () => []
    });
    assert.strictEqual(tick.shouldRun, true);
    assert.strictEqual(tick.apiKey, "k");
    assert.strictEqual(tick.secretKey, "s");
    assert.deepStrictEqual(tick.domains, ["a.test"]);
    assert.strictEqual(tick.porkbunApiBaseUrl, "https://api.porkbun.com/api/json/v3");
    assert.deepStrictEqual(tick.ipv4Services, ["https://v4.ident.me"]);
});

test("mergePutDdnsBody keeps keys when omitted on update", () => {
    const prev = {
        enabled: true,
        porkbunApiKey: "old-k",
        porkbunSecretKey: "old-s",
        domainMode: "explicit",
        domains: ["keep.test"],
        matchNote: "tag:keep",
        intervalMs: 300_000,
        ipLookupTimeoutMs: 8000,
        ipv4Services: ["https://api4.ipify.org"],
        ipv6Services: ["https://api6.ipify.org"],
        porkbunApiBaseUrl: DEFAULT_PORKBUN_API_BASE_URL
    };
    const m = mergePutDdnsBody(prev, { enabled: false }, isValidApexFQDN);
    assert.strictEqual(m.ok, true);
    assert.strictEqual(m.value.version, 2);
    const j0 = m.value.jobs[0];
    assert.strictEqual(j0.enabled, false);
    assert.strictEqual(j0.credentials.porkbunApiKey, "old-k");
    assert.strictEqual(j0.credentials.porkbunSecretKey, "old-s");
});

test("parseStoredDdnsRow rejects explicit mode with empty domains", () => {
    const r = parseStoredDdnsRow({
        enabled: true,
        porkbunApiKey: "a",
        porkbunSecretKey: "b",
        domainMode: "explicit",
        domains: [],
        matchNote: "x",
        intervalMs: 300_000,
        ipLookupTimeoutMs: 8000
    });
    assert.strictEqual(r.ok, false);
});

test("parseStoredDdnsRow rejects bad ipv4 URL", () => {
    const r = parseStoredDdnsRow({
        enabled: true,
        porkbunApiKey: "a",
        porkbunSecretKey: "b",
        domainMode: "explicit",
        domains: ["z.test"],
        matchNote: "match:reverse-proxy-ddns",
        intervalMs: 300_000,
        ipLookupTimeoutMs: 8000,
        ipv4Services: ["not-a-url"]
    });
    assert.strictEqual(r.ok, false);
});

