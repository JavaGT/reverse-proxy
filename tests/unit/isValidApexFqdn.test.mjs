import assert from "node:assert/strict";
import test from "node:test";
import { isValidApexFQDN } from "../../src/shared/utils/isValidApexFqdn.mjs";

test("isValidApexFQDN accepts common apex hostnames", () => {
    assert.equal(isValidApexFQDN("example.com"), true);
    assert.equal(isValidApexFQDN("sub.example.co.nz"), true);
    assert.equal(isValidApexFQDN("a-b.example.org"), true);
});

test("isValidApexFQDN rejects invalid labels and lengths", () => {
    assert.equal(isValidApexFQDN(""), false);
    assert.equal(isValidApexFQDN(" "), false);
    assert.equal(isValidApexFQDN("-bad.example.com"), false);
    assert.equal(isValidApexFQDN("bad-.example.com"), false);
    assert.equal(isValidApexFQDN(".."), false);
});
