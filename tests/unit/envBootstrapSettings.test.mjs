import test from "node:test";
import assert from "node:assert";
import {
    mergeServerSettingsSparseWithDefaults,
    mergedServerSettingsToEnvRecord,
    overlayEnvBootstrapForOmittedSqliteKeys
} from "../../src/config/serverSettingsRegistry.mjs";

test("overlayEnvBootstrapForOmittedSqliteKeys: env fills tlsCertDir when SQLite omits key", () => {
    const prev = process.env.TLS_CERT_DIR;
    process.env.TLS_CERT_DIR = "/env/path/certs";
    try {
        const sparse = {};
        const merged = mergeServerSettingsSparseWithDefaults(sparse);
        assert.strictEqual(merged.tlsCertDir, "");
        overlayEnvBootstrapForOmittedSqliteKeys(sparse, merged);
        assert.strictEqual(merged.tlsCertDir, "/env/path/certs");
    } finally {
        if (prev === undefined) delete process.env.TLS_CERT_DIR;
        else process.env.TLS_CERT_DIR = prev;
    }
});

test("overlayEnvBootstrapForOmittedSqliteKeys: SQLite value wins when key is present", () => {
    const prev = process.env.TLS_CERT_DIR;
    process.env.TLS_CERT_DIR = "/env/only";
    try {
        const sparse = { tlsCertDir: "/db/path" };
        const merged = mergeServerSettingsSparseWithDefaults(sparse);
        overlayEnvBootstrapForOmittedSqliteKeys(sparse, merged);
        assert.strictEqual(merged.tlsCertDir, "/db/path");
    } finally {
        if (prev === undefined) delete process.env.TLS_CERT_DIR;
        else process.env.TLS_CERT_DIR = prev;
    }
});

test("mergedServerSettingsToEnvRecord reflects overlay tlsCertDir", () => {
    const prev = process.env.TLS_CERT_DIR;
    process.env.TLS_CERT_DIR = "/overlay/certs";
    try {
        const sparse = {};
        const merged = mergeServerSettingsSparseWithDefaults(sparse);
        overlayEnvBootstrapForOmittedSqliteKeys(sparse, merged);
        const rec = mergedServerSettingsToEnvRecord(merged);
        assert.strictEqual(rec.TLS_CERT_DIR, "/overlay/certs");
    } finally {
        if (prev === undefined) delete process.env.TLS_CERT_DIR;
        else process.env.TLS_CERT_DIR = prev;
    }
});
