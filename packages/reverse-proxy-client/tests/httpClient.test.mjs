import test from "node:test";
import assert from "node:assert";
import { createHttpClient } from "../src/httpClient.mjs";
import { ManagementApiError } from "../src/errors.mjs";

test("createHttpClient maps JSON errors to ManagementApiError", async () => {
    const fetch = async () =>
        new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "nope", resolution: "sign in" } }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
        });

    const client = createHttpClient({ baseUrl: "http://127.0.0.1:9", fetch });
    await assert.rejects(
        () => client.getRoutes(),
        err => err instanceof ManagementApiError && err.code === "UNAUTHORIZED" && err.status === 401
    );
});

test("createHttpClient maps string error body to ManagementApiError", async () => {
    const fetch = async () =>
        new Response(JSON.stringify({ error: "Not authenticated" }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
        });

    const client = createHttpClient({ baseUrl: "http://127.0.0.1:9", fetch });
    await assert.rejects(
        () => client.getRoutes(),
        err =>
            err instanceof ManagementApiError &&
            err.code === "HTTP_ERROR" &&
            err.message === "Not authenticated" &&
            err.status === 401
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

test("createHttpClient postDdnsSync adds jobId query when provided", async () => {
    /** @type {string | undefined} */
    let seenUrl;
    const fetch = async (/** @type {string | URL | Request} */ input) => {
        seenUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
        return new Response(JSON.stringify({ data: { ok: true } }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    };

    const client = createHttpClient({ baseUrl: "http://127.0.0.1:9", fetch });
    await client.postDdnsSync("job-abc");
    assert.ok(seenUrl?.includes("/api/v1/ddns/sync?"), "path and query");
    assert.ok(seenUrl?.includes("jobId=job-abc"), "jobId param");
});
