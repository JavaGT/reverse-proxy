import test from "node:test";
import assert from "node:assert";
import {
    createManagementGetWebAuthnOptions,
    deriveManagementWebAuthnContext,
    managementHostOnly
} from "../../src/infrastructure/http/managementWebAuthnDynamic.mjs";

const fallback = { rpID: "env.apex.test", origin: "http://127.0.0.1:9", domain: "env.apex.test" };

test("managementHostOnly strips port and bracketed IPv6", () => {
    assert.strictEqual(managementHostOnly("mgmt.example.com:8443"), "mgmt.example.com");
    assert.strictEqual(managementHostOnly("[::1]:8080"), "::1");
});

test("derive: public hostname uses rpID = host and origin respects X-Forwarded-Proto", () => {
    const req = {
        get: h => {
            if (h === "host") return "reverse-proxy.example.com";
            if (h === "x-forwarded-proto") return "https";
            return undefined;
        },
        secure: false,
        protocol: "http"
    };
    const r = deriveManagementWebAuthnContext(/** @type {import("express").Request} */ (req), fallback);
    assert.strictEqual(r.rpID, "reverse-proxy.example.com");
    assert.strictEqual(r.domain, "reverse-proxy.example.com");
    assert.strictEqual(r.origin, "https://reverse-proxy.example.com");
});

test("derive: loopback IPv4 uses rpID localhost", () => {
    const req = {
        get: h => (h === "host" ? "127.0.0.1:24789" : undefined),
        secure: false,
        protocol: "http"
    };
    const r = deriveManagementWebAuthnContext(/** @type {import("express").Request} */ (req), fallback);
    assert.strictEqual(r.rpID, "localhost");
    assert.strictEqual(r.domain, "localhost");
    assert.strictEqual(r.origin, "http://127.0.0.1:24789");
});

test("derive: non-loopback IPv4 uses env fallback rpID", () => {
    const req = {
        get: h => (h === "host" ? "198.51.100.1:443" : "https"),
        secure: false,
        protocol: "http"
    };
    const r = deriveManagementWebAuthnContext(/** @type {import("express").Request} */ (req), fallback);
    assert.strictEqual(r.rpID, "env.apex.test");
    assert.strictEqual(r.origin, "https://198.51.100.1:443");
});

test("createManagementGetWebAuthnOptions matches derive + rpName", () => {
    const getOpts = createManagementGetWebAuthnOptions(fallback, "Test RP");
    const req = {
        get: h => {
            if (h === "host") return "live.example.net";
            if (h === "x-forwarded-proto") return "https";
            return undefined;
        },
        secure: false,
        protocol: "http"
    };
    const o = getOpts(/** @type {import("express").Request} */ (req));
    const d = deriveManagementWebAuthnContext(/** @type {import("express").Request} */ (req), fallback);
    assert.strictEqual(o.rpID, d.rpID);
    assert.strictEqual(o.origin, d.origin);
    assert.strictEqual(o.rpName, "Test RP");
});
