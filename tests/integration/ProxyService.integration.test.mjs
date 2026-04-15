import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { ProxyService } from "../../src/infrastructure/http/ProxyService.mjs";
import { RouteRegistry } from "../../src/domain/RouteRegistry.mjs";
import { logger } from "../../src/shared/utils/Logger.mjs";

test("ProxyService should block requests from IPs not in allowlist", async (t) => {
    // 1. Setup Registry with a restricted route
    const registry = new RouteRegistry("example.com");
    registry.reserve("restricted", 3000, { allowlist: ["127.0.0.1"] }, "example.com");

    // 2. Setup ProxyService
    const proxyService = new ProxyService(registry, () => ({}), logger);

    // 3. Mock Request and Response
    const req = {
        headers: { host: "restricted.example.com" },
        url: "/",
        method: "GET",
        socket: { remoteAddress: "1.1.1.1" }, // Mocked external IP
        on: () => {},
        pipe: () => {}
    };

    let statusCode = 0;
    let ended = false;
    const res = {
        writeHead: (code) => { statusCode = code; },
        end: () => { ended = true; },
        destroy: () => {}
    };

    // 4. Exercise
    proxyService.handleHttpRequest(req, res);

    // 5. Assert (Expect 403 Forbidden since 1.1.1.1 is not 127.0.0.1)
    assert.strictEqual(statusCode, 403, "Should return 403 Forbidden for blocked IP");
    assert.strictEqual(ended, true, "Response should be ended");
});

test("ProxyService should return 503 if no healthy targets", async (t) => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", 3000, {}, "example.com");
    registry.updateTargetHealth("http://localhost:3000", false);
    
    const proxyService = new ProxyService(registry, () => ({}), logger);
    
    const req = {
        headers: { host: "app.example.com" },
        url: "/",
        method: "GET",
        socket: { remoteAddress: "127.0.0.1" },
        on: () => {},
        pipe: () => {}
    };

    let statusCode = 0;
    const res = {
        writeHead: (code) => { statusCode = code; },
        end: () => {},
        destroy: () => {}
    };

    proxyService.handleHttpRequest(req, res);
    assert.strictEqual(statusCode, 503, "Should return 503 Service Unavailable");
});
