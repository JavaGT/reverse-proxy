import test from "node:test";
import assert from "node:assert";
import { createHttpClient } from "../src/httpClient.mjs";
import { ManagementApiError } from "../src/errors.mjs";

test("createHttpClient maps JSON errors to ManagementApiError", async () => {
    const fetch = async () =>
        new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "nope", resolution: "add token" } }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
        });

    const client = createHttpClient({ baseUrl: "http://127.0.0.1:9", fetch });
    await assert.rejects(
        () => client.getRoutes(),
        err => err instanceof ManagementApiError && err.code === "UNAUTHORIZED" && err.status === 401
    );
});

test("createHttpClient returns data envelope", async () => {
    const fetch = async () =>
        new Response(JSON.stringify({ data: { status: "OK" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    const client = createHttpClient({ baseUrl: "http://127.0.0.1:9", fetch });
    const r = await client.health();
    assert.deepStrictEqual(r, { data: { status: "OK" } });
});
