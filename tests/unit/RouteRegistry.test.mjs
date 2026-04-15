import assert from "node:assert";
import test from "node:test";
import { RouteRegistry } from "../../src/domain/RouteRegistry.mjs";
import { BaseDomainNotConfiguredError, BaseDomainRequiredError } from "../../src/domain/routeErrors.mjs";

test("RouteRegistry should handle multiple targets and Round-Robin", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", [3000, 3001], {}, "example.com");
    
    // First call -> 3000
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3000");
    // Second call -> 3001
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3001");
    // Third call -> 3000 (cycled)
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3000");
});

test("RouteRegistry should skip unhealthy targets", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", [3000, 3001], {}, "example.com");
    
    // Mark 3000 unhealthy
    registry.updateTargetHealth("http://localhost:3000", false);
    
    // Only 3001 should be returned
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3001");
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3001");
});

test("getPersistentRoutes strips volatile target fields (e.g. healthCheckedAt)", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", 3000, {}, "example.com");
    registry.updateTargetHealth("http://localhost:3000", false);
    const route = registry.getPersistentRoutes().find(r => r.host === "app.example.com");
    assert.ok(route);
    assert.deepStrictEqual(route.targets, [{ url: "http://localhost:3000", healthy: false }]);
});

test("updateTargetHealth records healthCheckedAt on matching upstreams", () => {
    const registry = new RouteRegistry("example.com");
    registry.registerEphemeralRoute("ephem.example.com", "http://localhost:9", { healthPath: "/h" });
    registry.updateTargetHealth("http://localhost:9", true);
    const r = registry.getRoute("ephem.example.com");
    assert.ok(r.targets[0].healthCheckedAt);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(r.targets[0].healthCheckedAt));
});

test("RouteRegistry should return null if no healthy targets", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", 3000, {}, "example.com");
    registry.updateTargetHealth("http://localhost:3000", false);
    
    assert.strictEqual(registry.getTarget("app.example.com"), null);
});

test("RouteRegistry hydrate skips rows without non-empty targets", () => {
    const registry = new RouteRegistry("example.com");
    registry.hydrate([
        { host: "a.example.com", targets: [{ url: "http://localhost:5000", healthy: true }] },
        { host: "skip.example.com", targets: [] },
        { host: "also-skip.example.com" }
    ]);

    assert.ok(registry.getRoute("a.example.com"));
    assert.strictEqual(registry.getRoute("skip.example.com"), undefined);
    assert.strictEqual(registry.getRoute("also-skip.example.com"), undefined);
});

test("RouteRegistry should release all counters on release", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", [3000, 3001], {}, "example.com");
    registry.getTarget("app.example.com"); // Inc counter

    registry.release("app", "example.com");
    registry.reserve("app", [3000, 3001], {}, "example.com");
    
    // Counter should be reset to 0
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3000");
});

test("RouteRegistry reserve requires baseDomain", () => {
    const registry = new RouteRegistry("example.com");
    assert.throws(
        () => registry.reserve("app", 3000),
        err => err instanceof BaseDomainRequiredError
    );
});

test("RouteRegistry rejects unlisted baseDomain with BaseDomainNotConfiguredError", () => {
    const registry = new RouteRegistry("example.com");
    assert.throws(
        () => registry.reserve("app", 3000, {}, "other.org"),
        err =>
            err instanceof BaseDomainNotConfiguredError &&
            err.details?.requested === "other.org" &&
            Array.isArray(err.details?.allowed)
    );
});

test("RouteRegistry setRootDomains updates primary and additional roots", () => {
    const registry = new RouteRegistry("a.test", { additionalRootDomains: ["b.test"] });
    registry.setRootDomains(["z.test", "y.test"]);
    assert.strictEqual(registry.rootDomain, "z.test");
    assert.deepStrictEqual(registry.getRootDomains(), ["y.test", "z.test"]);
});

test("RouteRegistry setRootDomains rejects when a route would be orphaned", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", 3000, {}, "example.com");
    assert.throws(
        () => registry.setRootDomains(["other.org"]),
        /not under any listed apex/
    );
});
