import assert from "node:assert";
import test from "node:test";
import {
    apexEligibleForDdnsProvider,
    apexEligibleForPorkbunDdns,
    resolveDnsConsoleLinks,
    resolveDnsConsoleProviderForApex
} from "../../src/infrastructure/dns/console/resolveConsoleLinks.mjs";
import { porkbunDnsConsole } from "../../src/infrastructure/dns/console/providers/porkbun.mjs";

test("resolveDnsConsoleLinks uses Porkbun defaultProvider", () => {
    const links = resolveDnsConsoleLinks(
        ["example.com"],
        { defaultProvider: "porkbun" },
        {}
    );
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].provider, "porkbun");
    assert.strictEqual(links[0].label, porkbunDnsConsole.label);
    assert.ok(links[0].url.includes("porkbun.com"));
    assert.ok(links[0].url.includes("example.com"));
});

test("Porkbun provider builds account domain URL", () => {
    const u = porkbunDnsConsole.buildManagementUrl("my.example.co.nz");
    assert.strictEqual(u, "https://porkbun.com/account/domain/my.example.co.nz");
});

test("apexEligibleForPorkbunDdns: default Porkbun includes apex", () => {
    assert.strictEqual(apexEligibleForPorkbunDdns("a.example", { defaultProvider: "porkbun" }, {}), true);
});

test("apexEligibleForPorkbunDdns: per-apex none excludes", () => {
    assert.strictEqual(
        apexEligibleForPorkbunDdns("skip.example", { defaultProvider: "porkbun", byApex: { "skip.example": "none" } }, {}),
        false
    );
});

test("apexEligibleForPorkbunDdns: no config still eligible (legacy)", () => {
    assert.strictEqual(apexEligibleForPorkbunDdns("legacy.test", null, {}), true);
});

test("apexEligibleForPorkbunDdns: env default porkbun", () => {
    assert.strictEqual(apexEligibleForPorkbunDdns("x.test", null, { DNS_CONSOLE_DEFAULT_PROVIDER: "porkbun" }), true);
});

test("apexEligibleForDdnsProvider namecheap mirrors porkbun gating", () => {
    assert.strictEqual(
        apexEligibleForDdnsProvider("namecheap", "a.example", { defaultProvider: "namecheap" }, {}),
        true
    );
    assert.strictEqual(
        apexEligibleForDdnsProvider("namecheap", "skip.example", { defaultProvider: "namecheap", byApex: { "skip.example": "none" } }, {}),
        false
    );
});

test("apexEligibleForPorkbunDdns: unknown env default does not exclude all apexes", () => {
    assert.strictEqual(apexEligibleForPorkbunDdns("x.test", null, { DNS_CONSOLE_DEFAULT_PROVIDER: "not-a-real-console" }), true);
});

test("resolveDnsConsoleProviderForApex: precedence byApex then default then env", () => {
    assert.deepStrictEqual(resolveDnsConsoleProviderForApex("a.com", { byApex: { "a.com": "none" } }, {}), {
        kind: "explicit_none"
    });
    assert.deepStrictEqual(resolveDnsConsoleProviderForApex("b.com", { defaultProvider: "porkbun" }, {}), {
        kind: "resolved",
        id: "porkbun"
    });
    assert.deepStrictEqual(resolveDnsConsoleProviderForApex("c.com", null, { DNS_CONSOLE_DEFAULT_PROVIDER: "porkbun" }), {
        kind: "resolved",
        id: "porkbun"
    });
    assert.deepStrictEqual(resolveDnsConsoleProviderForApex("d.com", null, {}), { kind: "unset" });
});
