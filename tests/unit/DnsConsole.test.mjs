import assert from "node:assert";
import test from "node:test";
import { resolveDnsConsoleLinks } from "../../src/infrastructure/dns/console/resolveConsoleLinks.mjs";
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
