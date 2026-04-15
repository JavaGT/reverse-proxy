import test from "node:test";
import assert from "node:assert";
import { SERVER_SETTING_DEFS } from "../../src/config/serverSettingsRegistry.mjs";
import { buildServerSettingsUiManifest, SERVER_SETTING_UI_GROUPS } from "../../src/config/serverSettingsUi.mjs";

test("buildServerSettingsUiManifest covers every SERVER_SETTING_DEFS key", () => {
    const { fields, groups } = buildServerSettingsUiManifest();
    assert.strictEqual(fields.length, SERVER_SETTING_DEFS.length);
    const keys = new Set(fields.map(f => f.key));
    for (const def of SERVER_SETTING_DEFS) {
        assert.ok(keys.has(def.key), def.key);
    }
});

test("SERVER_SETTING_UI_GROUPS only reference defined fields", () => {
    const keys = new Set(SERVER_SETTING_DEFS.map(d => d.key));
    for (const g of SERVER_SETTING_UI_GROUPS) {
        for (const k of g.keys) {
            assert.ok(keys.has(k), k);
        }
    }
});

test("buildServerSettingsUiManifest groups match exported group keys", () => {
    const { groups } = buildServerSettingsUiManifest();
    assert.deepStrictEqual(groups, SERVER_SETTING_UI_GROUPS);
});
