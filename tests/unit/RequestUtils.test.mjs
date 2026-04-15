import test from "node:test";
import assert from "node:assert";
import {
    describeManagementLocalOperatorCheck,
    effectiveManagementClientIp,
    isLocalRequest,
    managementClientIsLoopback,
    managementClientIsSameMachine,
    normalizeComparableIp,
    resolveManagementLocalOperator
} from "../../src/shared/utils/RequestUtils.mjs";

function reqWithRemote(addr) {
    return { socket: { remoteAddress: addr } };
}

test("isLocalRequest: 127.0.0.1", () => {
    assert.strictEqual(isLocalRequest(reqWithRemote("127.0.0.1")), true);
});

test("isLocalRequest: any 127.x.x.x loopback", () => {
    assert.strictEqual(isLocalRequest(reqWithRemote("127.42.3.1")), true);
});

test("isLocalRequest: IPv4-mapped loopback", () => {
    assert.strictEqual(isLocalRequest(reqWithRemote("::ffff:127.0.0.1")), true);
});

test("isLocalRequest: ::1", () => {
    assert.strictEqual(isLocalRequest(reqWithRemote("::1")), true);
});

test("isLocalRequest: non-loopback IPv4", () => {
    assert.strictEqual(isLocalRequest(reqWithRemote("10.0.0.1")), false);
});

test("isLocalRequest: missing socket address", () => {
    assert.strictEqual(isLocalRequest({ socket: {} }), false);
    assert.strictEqual(isLocalRequest({}), false);
});

test("effectiveManagementClientIp: prefers forwarded client when req.ip differs", () => {
    const req = {
        socket: { remoteAddress: "127.0.0.1" },
        ip: "198.51.100.2"
    };
    assert.strictEqual(effectiveManagementClientIp(req), "198.51.100.2");
    assert.strictEqual(managementClientIsLoopback(req), false);
});

test("managementClientIsLoopback: loopback when socket and req.ip agree", () => {
    assert.strictEqual(managementClientIsLoopback({ socket: { remoteAddress: "127.0.0.1" }, ip: "127.0.0.1" }), true);
});

test("normalizeComparableIp: IPv4-mapped and IPv6 zone", () => {
    assert.strictEqual(normalizeComparableIp("::ffff:192.0.2.1"), "192.0.2.1");
    assert.strictEqual(normalizeComparableIp("FE80::1%eth0"), "fe80::1");
});

test("managementClientIsSameMachine: loopback via req.ip", () => {
    assert.strictEqual(managementClientIsSameMachine({ socket: { remoteAddress: "127.0.0.1" }, ip: "127.0.0.1" }), true);
});

test("managementClientIsSameMachine: unrelated forwarded IP is not assumed same-machine", () => {
    const req = {
        socket: { remoteAddress: "127.0.0.1" },
        ip: "192.0.2.1"
    };
    assert.strictEqual(managementClientIsLoopback(req), false);
    assert.strictEqual(managementClientIsSameMachine(req), false);
});

test("managementClientIsSameMachine: MANAGEMENT_LOCAL_OPERATOR_IPS matches forwarded WAN-style IP", () => {
    const prev = process.env.MANAGEMENT_LOCAL_OPERATOR_IPS;
    process.env.MANAGEMENT_LOCAL_OPERATOR_IPS = "198.51.100.2";
    try {
        const req = {
            socket: { remoteAddress: "127.0.0.1" },
            ip: "198.51.100.2",
            headers: { "x-forwarded-for": "198.51.100.2" }
        };
        assert.strictEqual(managementClientIsSameMachine(req), true);
    } finally {
        if (prev === undefined) delete process.env.MANAGEMENT_LOCAL_OPERATOR_IPS;
        else process.env.MANAGEMENT_LOCAL_OPERATOR_IPS = prev;
    }
});

test("managementClientIsSameMachine: any X-Forwarded-For hop can match (not only leftmost)", () => {
    const prev = process.env.MANAGEMENT_LOCAL_OPERATOR_IPS;
    process.env.MANAGEMENT_LOCAL_OPERATOR_IPS = "192.0.2.88";
    try {
        const req = {
            socket: { remoteAddress: "127.0.0.1" },
            ip: "203.0.113.10",
            headers: { "x-forwarded-for": "203.0.113.10, 192.0.2.88" }
        };
        assert.strictEqual(managementClientIsSameMachine(req), true);
    } finally {
        if (prev === undefined) delete process.env.MANAGEMENT_LOCAL_OPERATOR_IPS;
        else process.env.MANAGEMENT_LOCAL_OPERATOR_IPS = prev;
    }
});

test("resolveManagementLocalOperator matches describeManagementLocalOperatorCheck", () => {
    const req = { socket: { remoteAddress: "127.0.0.1" }, ip: "127.0.0.1" };
    assert.deepStrictEqual(resolveManagementLocalOperator(req), describeManagementLocalOperatorCheck(req));
});

test("describeManagementLocalOperatorCheck agrees with managementClientIsSameMachine", () => {
    const samples = [
        { socket: { remoteAddress: "127.0.0.1" }, ip: "127.0.0.1" },
        {
            socket: { remoteAddress: "127.0.0.1" },
            ip: "192.0.2.1",
            headers: { "x-forwarded-for": "192.0.2.1" }
        },
        {
            socket: { remoteAddress: "127.0.0.1" },
            ip: "203.0.113.10",
            headers: { "x-forwarded-for": "203.0.113.10" }
        }
    ];
    for (const req of samples) {
        const d = describeManagementLocalOperatorCheck(req);
        assert.strictEqual(
            d.sameMachine,
            managementClientIsSameMachine(req),
            `mismatch for ${JSON.stringify(req)}`
        );
    }
});
