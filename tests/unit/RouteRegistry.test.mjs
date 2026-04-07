import assert from "node:assert";
import test from "node:test";
import { RouteRegistry } from "../../src/domain/RouteRegistry.mjs";

test("RouteRegistry should handle multiple targets and Round-Robin", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", [3000, 3001]);
    
    // First call -> 3000
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3000");
    // Second call -> 3001
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3001");
    // Third call -> 3000 (cycled)
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3000");
});

test("RouteRegistry should skip unhealthy targets", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", [3000, 3001]);
    
    // Mark 3000 unhealthy
    registry.updateTargetHealth("http://localhost:3000", false);
    
    // Only 3001 should be returned
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3001");
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3001");
});

test("RouteRegistry should return null if no healthy targets", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", 3000);
    registry.updateTargetHealth("http://localhost:3000", false);
    
    assert.strictEqual(registry.getTarget("app.example.com"), null);
});

test("RouteRegistry should support legacy hydration format", () => {
    const registry = new RouteRegistry("example.com");
    registry.hydrate([
        { host: "legacy.example.com", target: "http://localhost:5000" }
    ]);
    
    const route = registry.getRoute("legacy.example.com");
    assert.strictEqual(route.targets[0].url, "http://localhost:5000");
});

test("RouteRegistry should release all counters on release", () => {
    const registry = new RouteRegistry("example.com");
    registry.reserve("app", [3000, 3001]);
    registry.getTarget("app.example.com"); // Inc counter
    
    registry.release("app");
    registry.reserve("app", [3000, 3001]);
    
    // Counter should be reset to 0
    assert.strictEqual(registry.getTarget("app.example.com"), "http://localhost:3000");
});
