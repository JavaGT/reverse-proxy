import { randomBytes } from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import os from "node:os";

/** Same defaults as DDNS scheduler (public egress IP discovery). */
const DEFAULT_IPV4_SERVICES = [
    "https://api4.ipify.org",
    "https://ipv4.icanhazip.com",
    "https://v4.ident.me",
    "https://ifconfig.me/ip"
];

const DEFAULT_IPV6_SERVICES = [
    "https://api6.ipify.org",
    "https://ipv6.icanhazip.com",
    "https://v6.ident.me",
    "https://ifconfig.me/ip"
];

function parseTimeoutMs(raw, fallback) {
    const n = parseInt(String(raw ?? "").trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseIngressProbePort(raw) {
    const n = parseInt(String(raw ?? "").trim(), 10);
    return Number.isInteger(n) && n > 0 && n <= 65535 ? n : 443;
}

/**
 * Try to reach this machine's HTTPS ingress using the reported public IP (hairpin / port-forward sanity check).
 * TLS verification is disabled because certificates are normally issued for hostnames, not bare IPs.
 * @param {string} ip
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, statusCode: number | null, error: string | null, url: string }>}
 */
function probeHttpsViaPublicIp(ip, port, timeoutMs) {
    const hostInUrl = ip.includes(":") ? `[${ip}]` : ip;
    const url = `https://${hostInUrl}:${port}/`;

    return new Promise(resolve => {
        let settled = false;
        const done = payload => {
            if (settled) return;
            settled = true;
            resolve(payload);
        };

        let req;
        try {
            const u = new URL(url);
            req = https.request(
                {
                    protocol: u.protocol,
                    hostname: u.hostname,
                    port: u.port || port,
                    path: u.pathname || "/",
                    method: "GET",
                    timeout: timeoutMs,
                    rejectUnauthorized: false,
                    headers: { Host: u.hostname, Connection: "close" }
                },
                res => {
                    res.resume();
                    res.on("end", () => {
                        done({ ok: true, statusCode: res.statusCode ?? null, error: null, url });
                    });
                    res.on("error", err => {
                        done({ ok: false, statusCode: null, error: err?.message || "response error", url });
                    });
                }
            );
        } catch (e) {
            done({ ok: false, statusCode: null, error: e?.message || "bad url", url });
            return;
        }

        req.on("error", err => {
            done({ ok: false, statusCode: null, error: err?.message || "request error", url });
        });
        req.on("timeout", () => {
            req.destroy();
            done({ ok: false, statusCode: null, error: "timeout", url });
        });
        req.end();
    });
}

/**
 * @param {{ ipv4: string | null, ipv6: string | null, port: number, timeoutMs: number }} params
 */
async function probeSelfViaPublicIngress(params) {
    const { ipv4, ipv6, port, timeoutMs } = params;
    const [v4, v6] = await Promise.all([
        ipv4 ? probeHttpsViaPublicIp(ipv4, port, timeoutMs) : null,
        ipv6 ? probeHttpsViaPublicIp(ipv6, port, timeoutMs) : null
    ]);
    return { port, ipv4: v4, ipv6: v6 };
}

function timeoutPromise(ms) {
    return new Promise((_, reject) => {
        const t = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), ms);
        t.unref?.();
    });
}

/**
 * Non-loopback interface addresses (IPv4 and IPv6).
 * @returns {{ interface: string, address: string, family: 'IPv4' | 'IPv6', internal: boolean }[]}
 */
function getLocalAddresses() {
    const out = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs ?? []) {
            if (!a) continue;
            const family = a.family === "IPv6" || a.family === 6 ? "IPv6" : "IPv4";
            out.push({
                interface: name,
                address: a.address,
                family,
                internal: !!a.internal
            });
        }
    }
    return out;
}

/**
 * @param {'v4' | 'v6'} kind
 */
async function fetchPublicIpFromServices(urls, timeoutMs, kind) {
    for (const url of urls) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
            if (!res.ok) continue;
            const ip = (await res.text()).trim();
            if (!ip) continue;
            if (kind === "v4" && ip.includes(".") && !ip.includes(":")) return ip;
            if (kind === "v6" && ip.includes(":")) return ip;
        } catch {
            /* try next */
        }
    }
    return null;
}

/**
 * @param {{ ipv4Services?: string[], ipv6Services?: string[], ipLookupTimeoutMs?: number }} [options]
 */
export async function lookupPublicIps(options = {}) {
    const ipLookupTimeoutMs = options.ipLookupTimeoutMs ?? parseTimeoutMs(process.env.IP_LOOKUP_TIMEOUT_MS, 8000);
    const ipv4Services = options.ipv4Services ?? DEFAULT_IPV4_SERVICES;
    const ipv6Services = options.ipv6Services ?? DEFAULT_IPV6_SERVICES;

    const [ipv4, ipv6] = await Promise.all([
        fetchPublicIpFromServices(ipv4Services, ipLookupTimeoutMs, "v4"),
        fetchPublicIpFromServices(ipv6Services, ipLookupTimeoutMs, "v6")
    ]);
    return { ipv4, ipv6 };
}

async function tryResolve(fn, host, timeoutMs) {
    try {
        const records = await Promise.race([fn(host), timeoutPromise(timeoutMs)]);
        return { records: [...new Set(records)].sort(), error: null };
    } catch (e) {
        const code = e?.code;
        if (code === "ENOTFOUND" || code === "ENODATA") return { records: [], error: null };
        if (code === "ETIMEOUT") return { records: [], error: "DNS timeout" };
        return { records: [], error: e?.message || String(code || "DNS error") };
    }
}

/**
 * @param {string} host
 * @param {number} timeoutMs
 * @returns {Promise<{ ipv4: string[], ipv6: string[], errors: string[] }>}
 */
async function resolveHostDns(host, timeoutMs) {
    const v4 = await tryResolve(h => dns.resolve4(h), host, timeoutMs);
    const v6 = await tryResolve(h => dns.resolve6(h), host, timeoutMs);
    const errors = [v4.error, v6.error].filter(Boolean);
    return { ipv4: v4.records, ipv6: v6.records, errors };
}

function publicMatch(ips, pub) {
    return !!(pub && ips?.length && ips.includes(pub));
}

/**
 * DNS snapshot per configured apex only (apex + catch-all probe). Route hostnames are not listed here.
 * @param {{ getRootDomains: () => string[] }} registry
 * @param {{ dnsTimeoutMs?: number, wildcardToken?: string }} [options]
 */
async function buildDnsReport(registry, options = {}) {
    const dnsTimeoutMs = options.dnsTimeoutMs ?? parseTimeoutMs(process.env.DNS_LOOKUP_TIMEOUT_MS, 5000);
    const wildcardToken =
        options.wildcardToken ?? `rp-wc-${randomBytes(4).toString("hex")}`;

    const apexDomains = registry.getRootDomains();

    const rowGroups = await Promise.all(
        apexDomains.map(async apex => {
            const probeHost = `${wildcardToken}.${apex}`;
            const [apexRes, wildRes] = await Promise.all([
                resolveHostDns(apex, dnsTimeoutMs),
                resolveHostDns(probeHost, dnsTimeoutMs)
            ]);
            return [
                {
                    rowKind: "apex",
                    label: "Apex",
                    displayName: apex,
                    queryName: apex,
                    ipv4: apexRes.ipv4,
                    ipv6: apexRes.ipv6,
                    errors: apexRes.errors
                },
                {
                    rowKind: "wildcard",
                    label: "Catch-all",
                    displayName: `*.${apex}`,
                    queryName: probeHost,
                    ipv4: wildRes.ipv4,
                    ipv6: wildRes.ipv6,
                    errors: wildRes.errors
                }
            ];
        })
    );
    const rows = rowGroups.flat();

    return { rows, wildcardProbeToken: wildcardToken };
}

/** @param {{ getRootDomains: () => string[], getAllRoutes: () => { host: string }[], baseDomainForHost: (h: string) => string }} registry */
export async function collectNetworkStatus(registry) {
    const ipLookupTimeoutMs = parseTimeoutMs(process.env.IP_LOOKUP_TIMEOUT_MS, 8000);
    const dnsTimeoutMs = parseTimeoutMs(process.env.DNS_LOOKUP_TIMEOUT_MS, 5000);
    const ingressProbePort = parseIngressProbePort(process.env.PUBLIC_INGRESS_PROBE_HTTPS_PORT);
    const ingressProbeTimeoutMs = parseTimeoutMs(process.env.PUBLIC_INGRESS_PROBE_TIMEOUT_MS, 5000);

    const localAddresses = getLocalAddresses();
    const [publicIp, dnsReport] = await Promise.all([
        lookupPublicIps({ ipLookupTimeoutMs }),
        buildDnsReport(registry, { dnsTimeoutMs })
    ]);

    const rows = dnsReport.rows.map(r => ({
        ...r,
        matchesPublicIpv4: publicMatch(r.ipv4, publicIp.ipv4),
        matchesPublicIpv6: publicMatch(r.ipv6, publicIp.ipv6)
    }));

    const publicIngressSelfCheck = await probeSelfViaPublicIngress({
        ipv4: publicIp.ipv4,
        ipv6: publicIp.ipv6,
        port: ingressProbePort,
        timeoutMs: ingressProbeTimeoutMs
    });

    /** When no public IPv4 is discovered, CGNAT is a common explanation for home / mobile ISP links. */
    const cgnatNote =
        publicIp.ipv4 == null
            ? "No public IPv4 was detected. If you expect inbound IPv4 (port forwarding, DDNS A records), your ISP may be using CGNAT, which shares one public address among many customers so your router never receives a dedicated public IPv4. IPv6, a VPN, or a tunnel service may be required instead."
            : null;

    return {
        generatedAt: new Date().toISOString(),
        localAddresses,
        publicIp,
        publicIngressSelfCheck,
        cgnatNote,
        dns: {
            rows,
            wildcardProbeToken: dnsReport.wildcardProbeToken
        }
    };
}
