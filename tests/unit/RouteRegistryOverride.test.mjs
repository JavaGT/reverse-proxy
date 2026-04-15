import assert from "node:assert";
import test from "node:test";
import { RouteRegistry } from "../../src/domain/RouteRegistry.mjs";

test("RouteRegistry override: should block override if existing service is healthy with health check", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", 3000, { healthPath: "/health" }, "example.com");

    assert.throws(() => {
        registry.reserve("app", 3001, {}, "example.com");
    }, {
        message: "app.example.com is already reserved by a healthy service. Override denied."
    });
});

test("RouteRegistry override: should allow override if existing service has no health check", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", 3000, {}, "example.com");

    registry.reserve("app", 3001, {}, "example.com");
    
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3001");
});

test("RouteRegistry override: should allow override if all targets of existing service are unhealthy", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", 3000, { healthPath: "/health" }, "example.com");

    registry.updateTargetHealth("http://localhost:3000", false);

    registry.reserve("app", 3001, { healthPath: "/new-health" }, "example.com");
    
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3001");
    assert.strictEqual(registry.getRoute("app.example.com").options.healthPath, "/new-health");
});

test("RouteRegistry reserve: should be idempotent for identical mapping", () => {
    const registry = new RouteRegistry("example.com");
    const a = registry.reserve("app", 3000, { healthPath: "/health" }, "example.com");
    const b = registry.reserve("app", 3000, { healthPath: "/health" }, "example.com");
    assert.strictEqual(a.host, b.host);
    assert.strictEqual(a.targets[0].url, b.targets[0].url);
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3000");
});

test("RouteRegistry: baseDomain is always required for release", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("svc", 4000, {}, "example.com");
    assert.throws(() => registry.release("svc"), /baseDomain is required/);
    assert.ok(registry.release("svc", "example.com"));
});
