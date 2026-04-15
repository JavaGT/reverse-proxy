import test from "node:test";
import assert from "node:assert";
import { messageFromErrorBody } from "../../src/infrastructure/http/ui/api-client.mjs";

test("messageFromErrorBody: management envelope", () => {
    assert.strictEqual(
        messageFromErrorBody({ error: { message: "bad", resolution: "fix it" } }, 400),
        "bad — fix it"
    );
});

test("messageFromErrorBody: express-easy-auth string error", () => {
    assert.strictEqual(messageFromErrorBody({ error: "API Key required" }, 401), "API Key required");
});

test("messageFromErrorBody: plain string body", () => {
    assert.strictEqual(messageFromErrorBody("oops", 500), "oops");
});
