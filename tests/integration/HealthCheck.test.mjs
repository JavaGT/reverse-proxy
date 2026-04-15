import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { ManagementServer } from "../../src/infrastructure/http/ManagementServer.mjs";
import { ManagementController } from "../../src/api/ManagementController.mjs";
import { RouteRegistry } from "../../src/domain/RouteRegistry.mjs";
import { HealthCheckService } from "../../src/infrastructure/http/HealthCheckService.mjs";

const mockLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {}
};

const mockPersistence = {
    save: async () => {},
    saveRootDomainConfig: async () => {},
    getRootDomainConfig: () => null,
    load: async () => ({ routes: [], manualOverrides: {}, rootDomainConfig: null })
};

test("HealthCheckService should only perform health checks if healthPath is provided (opt-in)", async (t) => {
    let requestCount = 0;
    let lastRequestPath = "";
    
    // 1. Setup a dummy target server
    const targetServer = http.createServer((req, res) => {
        requestCount++;
        lastRequestPath = req.url;
        res.writeHead(200);
        res.end("OK");
    });
    
    const targetPort = await new Promise(resolve => {
        targetServer.listen(0, "127.0.0.1", () => resolve(targetServer.address().port));
    });

    try {
        const registry = new RouteRegistry("example.com");
        const healthService = new HealthCheckService(registry, mockLogger, 100);

        // Test Case 1: No healthPath provided (opted out)
        registry.registerEphemeralRoute("no-health.example.com", `http://127.0.0.1:${targetPort}`);
        await healthService.checkAll();
        assert.strictEqual(requestCount, 0, "Should not make any requests if healthPath is omitted");

        // Test Case 2: Custom path provided (opted in)
        registry.registerPersistentRoute("custom.example.com", [`http://127.0.0.1:${targetPort}`], { healthPath: "/api/health" });
        await healthService.checkAll();
        assert.strictEqual(requestCount, 1, "Should make exactly 1 request");
        assert.strictEqual(lastRequestPath, "/api/health", "Should use provided healthPath");

        const route = registry.getRoute("custom.example.com");
        assert.ok(route?.targets[0]?.healthCheckedAt, "Should record last check time");
        assert.strictEqual(route.targets[0].healthy, true);

    } finally {
        targetServer.close();
    }
});
