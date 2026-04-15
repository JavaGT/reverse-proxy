import assert from "node:assert";
import test from "node:test";
import { normalizeReserveOptions, ReserveValidationError } from "../../src/shared/utils/ReserveOptions.mjs";

test("normalizeReserveOptions rejects invalid healthPath", () => {
    assert.throws(
        () => normalizeReserveOptions({ healthPath: "//bad" }),
        (e) => e instanceof ReserveValidationError && e.code === "INVALID_HEALTH_PATH"
    );
});