import { isLoopbackAddr } from "is-loopback-addr";
import os from "node:os";

/**
 * @param {import("http").IncomingMessage} req
 * @param {string} name
 * @returns {string | undefined}
 */
function getIncomingHeader(req, name) {
    const h = req.headers;
    if (!h || typeof h !== "object") return undefined;
    const v = h[name.toLowerCase()];
    if (Array.isArray(v)) return v[0];
    return typeof v === "string" ? v : undefined;
}

/**
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function ipsFromForwardedForHeader(raw) {
    if (raw == null || typeof raw !== "string") return [];
    const out = [];
    for (const part of raw.split(",")) {
        const t = part.trim();
        if (t) out.push(t);
    }
    return out;
}

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
function normalizeIpString(raw) {
    if (raw == null || typeof raw !== "string") return null;
    const t = raw.trim();
    if (!t) return null;
    return t.startsWith("::ffff:") ? t.slice(7) : t;
}

/**
 * @param {import("http").IncomingMessage} req
 * @returns {string | null}
 */
function socketRemoteIpString(req) {
    return normalizeIpString(req.socket?.remoteAddress);
}

/**
 * True when the TCP peer is a loopback address (127.0.0.0/8 or ::1).
 * IPv4-mapped IPv6 (`::ffff:127.x.x.x`) is normalized before checking.
 * @param {import("http").IncomingMessage} req
 */
export function isLocalRequest(req) {
    const ip = socketRemoteIpString(req);
    if (!ip) return false;
    return isLoopbackAddr(ip);
}

/**
 * Client IP after Express `trust proxy` (e.g. leftmost `X-Forwarded-For` when trusted).
 * @param {import("http").IncomingMessage & { ip?: string }} req
 * @returns {string | null}
 */
export function effectiveManagementClientIp(req) {
    const socketIp = socketRemoteIpString(req);
    const expressIp = normalizeIpString(typeof req.ip === "string" ? req.ip : "");
    if (expressIp && socketIp && expressIp !== socketIp) return expressIp;
    return socketIp;
}

/**
 * True when the **logical** client is loopback (uses forwarded IP when it differs from the TCP peer).
 * Use for skipping remote auth when the operator is on the same machine as the proxy.
 * @param {import("http").IncomingMessage & { ip?: string }} req
 */
export function managementClientIsLoopback(req) {
    const ip = effectiveManagementClientIp(req);
    return !!(ip && isLoopbackAddr(ip));
}

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
function stripIpv6Zone(raw) {
    if (raw == null || typeof raw !== "string") return null;
    const z = raw.indexOf("%");
    return z === -1 ? raw : raw.slice(0, z);
}

/**
 * Normalize for set membership (IPv4-mapped IPv6, optional zone id, IPv6 lower case).
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function normalizeComparableIp(raw) {
    let t = normalizeIpString(raw);
    if (!t) return null;
    t = stripIpv6Zone(t);
    if (t.includes(":")) return t.toLowerCase();
    return t;
}

/**
 * Optional comma-separated IPs (e.g. public WAN) that count as “same machine” when behind a reverse
 * proxy: hairpin/NAT can put a public address in `X-Forwarded-For` that does not appear on
 * `os.networkInterfaces()`.
 */
function extraLocalOperatorComparableIps() {
    const raw = process.env.MANAGEMENT_LOCAL_OPERATOR_IPS?.trim();
    if (!raw) return new Set();
    const set = new Set();
    for (const part of raw.split(",")) {
        const n = normalizeComparableIp(part.trim());
        if (n) set.add(n);
    }
    return set;
}

function isAutoPublicEgressDisabled() {
    const v = process.env.MANAGEMENT_AUTO_PUBLIC_EGRESS_IP?.trim().toLowerCase();
    return v === "0" || v === "false";
}

/**
 * Normalized comparable IPs from the same egress lookup as GET /api/v1/network (hairpin / WAN in XFF).
 * @type {{ ipv4: string | null, ipv6: string | null, expires: number }}
 */
let managementPublicEgressCache = { ipv4: null, ipv6: null, expires: 0 };

const MANAGEMENT_PUBLIC_EGRESS_CACHE_TTL_MS = 600_000;

function activePublicEgressComparableIps() {
    if (Date.now() >= managementPublicEgressCache.expires) {
        return { ipv4: null, ipv6: null };
    }
    return {
        ipv4: managementPublicEgressCache.ipv4,
        ipv6: managementPublicEgressCache.ipv6
    };
}

function publicEgressComparableIpSet() {
    if (isAutoPublicEgressDisabled()) return new Set();
    const s = new Set();
    const { ipv4, ipv6 } = activePublicEgressComparableIps();
    if (ipv4) s.add(ipv4);
    if (ipv6) s.add(ipv6);
    return s;
}

/**
 * Refreshes cached public IPv4/IPv6 (outbound HTTP lookup) for matching `X-Forwarded-For` when hairpin
 * exposes your WAN address. Called from `ManagementServer` at startup and on an interval.
 *
 * @returns {Promise<{ ipv4: string | null, ipv6: string | null, skipped?: boolean }>}
 */
export async function refreshManagementPublicEgressCache() {
    if (isAutoPublicEgressDisabled()) {
        return { ipv4: null, ipv6: null, skipped: true };
    }
    try {
        const { lookupPublicIps } = await import("../../infrastructure/network/networkStatus.mjs");
        const { ipv4, ipv6 } = await lookupPublicIps();
        const v4n = ipv4 ? normalizeComparableIp(ipv4) : null;
        const v6n = ipv6 ? normalizeComparableIp(ipv6) : null;
        managementPublicEgressCache = {
            ipv4: v4n,
            ipv6: v6n,
            expires: Date.now() + MANAGEMENT_PUBLIC_EGRESS_CACHE_TTL_MS
        };
        return { ipv4: v4n, ipv6: v6n };
    } catch {
        return { ipv4: managementPublicEgressCache.ipv4, ipv6: managementPublicEgressCache.ipv6 };
    }
}

export function getManagementPublicEgressRefreshIntervalMs() {
    return MANAGEMENT_PUBLIC_EGRESS_CACHE_TTL_MS;
}

/**
 * Candidate client IPs for same-machine checks: every `X-Forwarded-For` hop (some proxies append),
 * `X-Real-IP`, and Express’s effective IP. Used so a hop that matches a local interface is not
 * missed when it is not the leftmost address.
 * @param {import("http").IncomingMessage & { ip?: string }} req
 * @returns {string[]}
 */
export function managementSameMachineCandidateIps(req) {
    const seen = new Set();
    const ordered = [];
    const push = raw => {
        const n = normalizeComparableIp(raw);
        if (!n || seen.has(n)) return;
        seen.add(n);
        ordered.push(raw);
    };
    for (const ip of ipsFromForwardedForHeader(getIncomingHeader(req, "x-forwarded-for"))) {
        push(ip);
    }
    push(getIncomingHeader(req, "x-real-ip"));
    const eff = effectiveManagementClientIp(req);
    if (eff) push(eff);
    return ordered;
}

/** @type {{ set: Set<string>, expires: number }} */
let machineIpCache = { set: new Set(), expires: 0 };

function collectNormalizedMachineIps() {
    const set = new Set();
    for (const infos of Object.values(os.networkInterfaces())) {
        if (!infos) continue;
        for (const info of infos) {
            const c = normalizeComparableIp(info.address);
            if (c) set.add(c);
        }
    }
    return set;
}

/**
 * Cached list of addresses assigned to this host (loopback + non-loopback interfaces).
 * Refreshes periodically so DHCP / interface changes are picked up.
 */
function machineComparableIpSet(ttlMs = 10_000) {
    const now = Date.now();
    if (now < machineIpCache.expires) {
        return machineIpCache.set;
    }
    const set = collectNormalizedMachineIps();
    machineIpCache = { set, expires: now + ttlMs };
    return set;
}

/**
 * @typedef {{
 *   sameMachine: boolean,
 *   reason: 'loopback' | 'machine_iface' | 'extra_env' | 'public_egress' | 'none',
 *   socketPeer: string | null,
 *   expressIp: string | null,
 *   forwardedFor: string | undefined,
 *   xRealIp: string | undefined,
 *   effectiveClientIp: string | null,
 *   candidateChecks: Array<{ raw: string, normalized: string | null, inMachine: boolean, inExtra: boolean, inEgress: boolean }>,
 *   machineIfaceCount: number,
 *   extraEnvIpCount: number,
 *   egressIpv4Comparable: string | null,
 *   egressIpv6Comparable: string | null,
 *   autoPublicEgressDisabled: boolean
 * }} ManagementLocalOperatorAudit
 */

/**
 * Single evaluation of same-machine / local-operator policy (loopback, interface match, env, egress cache).
 * Use for `req.mgmtLocalOperator` attachment and for callers without Express middleware.
 *
 * @param {import("http").IncomingMessage & { ip?: string }} req
 * @returns {ManagementLocalOperatorAudit}
 */
export function resolveManagementLocalOperator(req) {
    const socketPeer = socketRemoteIpString(req);
    const expressIp = normalizeIpString(typeof req.ip === "string" ? req.ip : "");
    const forwardedFor = getIncomingHeader(req, "x-forwarded-for");
    const xRealIp = getIncomingHeader(req, "x-real-ip");
    const effectiveClientIp = effectiveManagementClientIp(req);
    const set = machineComparableIpSet();
    const extra = extraLocalOperatorComparableIps();
    const egress = publicEgressComparableIpSet();
    const egressSnap = activePublicEgressComparableIps();
    const autoPublicEgressDisabled = isAutoPublicEgressDisabled();

    if (managementClientIsLoopback(req)) {
        return {
            sameMachine: true,
            reason: "loopback",
            socketPeer,
            expressIp,
            forwardedFor,
            xRealIp,
            effectiveClientIp,
            candidateChecks: [],
            machineIfaceCount: set.size,
            extraEnvIpCount: extra.size,
            egressIpv4Comparable: egressSnap.ipv4,
            egressIpv6Comparable: egressSnap.ipv6,
            autoPublicEgressDisabled
        };
    }

    const candidateChecks = [];
    for (const raw of managementSameMachineCandidateIps(req)) {
        const normalized = normalizeComparableIp(raw);
        const inMachine = !!(normalized && set.has(normalized));
        const inExtra = !!(normalized && extra.has(normalized));
        const inEgress = !!(normalized && egress.has(normalized));
        candidateChecks.push({ raw, normalized, inMachine, inExtra, inEgress });
    }
    const hit = candidateChecks.find(c => c.inMachine || c.inExtra || c.inEgress);
    const sameMachine = !!hit;
    const reason = !sameMachine
        ? "none"
        : hit.inMachine
          ? "machine_iface"
          : hit.inExtra
            ? "extra_env"
            : "public_egress";

    return {
        sameMachine,
        reason,
        socketPeer,
        expressIp,
        forwardedFor,
        xRealIp,
        effectiveClientIp,
        candidateChecks,
        machineIfaceCount: set.size,
        extraEnvIpCount: extra.size,
        egressIpv4Comparable: egressSnap.ipv4,
        egressIpv6Comparable: egressSnap.ipv6,
        autoPublicEgressDisabled
    };
}

/**
 * Same payload as {@link resolveManagementLocalOperator} (alias for debugging / tests).
 * @param {import("http").IncomingMessage & { ip?: string }} req
 * @returns {ManagementLocalOperatorAudit}
 */
export function describeManagementLocalOperatorCheck(req) {
    return resolveManagementLocalOperator(req);
}

/**
 * True when the logical client is on this machine: loopback, or `X-Forwarded-For` (when trusted)
 * resolves to an address assigned to a local interface. Use with a reverse proxy on loopback so
 * operators who open the public management hostname from the server itself skip remote auth.
 *
 * Every comma-separated hop in `X-Forwarded-For` is checked (not only the leftmost): some proxies
 * prepend the original client; others append. Optional `MANAGEMENT_LOCAL_OPERATOR_IPS` adds extra
 * addresses (e.g. WAN) when hairpin NAT does not expose them on a local interface.
 * When `MANAGEMENT_AUTO_PUBLIC_EGRESS_IP` is enabled (default), cached outbound public IPv4/IPv6
 * (same discovery as GET /api/v1/network) also counts so hairpin to your WAN matches without env.
 * @param {import("http").IncomingMessage & { ip?: string }} req
 */
export function managementClientIsSameMachine(req) {
    return resolveManagementLocalOperator(req).sameMachine;
}
