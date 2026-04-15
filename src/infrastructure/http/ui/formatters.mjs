/** Pure helpers for routes, DNS tables, DDNS labels, and HTML escaping. */

export function subdomainFromRoute(route) {
    const h = route.host;
    const base = route.baseDomain || route.rootDomain;
    if (base && h.endsWith("." + base)) {
        return h.slice(0, -(base.length + 1));
    }
    const i = h.indexOf(".");
    return i === -1 ? h : h.slice(0, i);
}

/** Upstream port numbers from route target URLs (http/https localhost). */
export function portsFromRouteTargets(route) {
    const out = [];
    for (const t of route.targets || []) {
        try {
            const u = new URL(t.url);
            if (u.port) out.push(parseInt(u.port, 10));
            else if (u.protocol === "http:") out.push(80);
            else if (u.protocol === "https:") out.push(443);
        } catch {
            /* ignore */
        }
    }
    return out;
}

/**
 * @param {string | undefined} iso - ISO time from server
 * @param {Date} [now]
 * @returns {string}
 */
export function formatHealthCheckedAt(iso, now = new Date()) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const pad = n => String(n).padStart(2, "0");
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    const time = `${hh}:${mm}:${ss}`;
    if (d.toDateString() === now.toDateString()) return time;
    const y = d.getFullYear();
    const mo = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    if (y === now.getFullYear()) return `${mo}-${day} ${time}`;
    return `${String(y).slice(-2)}-${mo}-${day} ${time}`;
}

function stripIpv6Zone(ip) {
    const s = String(ip).trim();
    const i = s.indexOf("%");
    return i === -1 ? s : s.slice(0, i);
}

/**
 * All IPs reported for this host (local interfaces + public lookup), for UI matching.
 * @param {object} networkData - `/api/v1/network` `data` payload
 * @returns {Set<string>}
 */
export function buildServerIpSet(networkData) {
    const set = new Set();
    for (const a of networkData.localAddresses || []) {
        const raw = String(a.address || "").trim();
        if (!raw) continue;
        set.add(raw);
        set.add(raw.toLowerCase());
        if (raw.includes(":")) {
            const z = stripIpv6Zone(raw);
            set.add(z);
            set.add(z.toLowerCase());
        }
    }
    const pub = networkData.publicIp || {};
    for (const k of ["ipv4", "ipv6"]) {
        const raw = pub[k];
        if (raw == null || typeof raw !== "string") continue;
        const t = raw.trim();
        if (!t) continue;
        set.add(t);
        set.add(t.toLowerCase());
        if (t.includes(":")) {
            const z = stripIpv6Zone(t);
            set.add(z);
            set.add(z.toLowerCase());
        }
    }
    return set;
}

function ipMatchesServer(ip, serverSet) {
    const t = String(ip).trim();
    if (!t) return false;
    if (serverSet.has(t) || serverSet.has(t.toLowerCase())) return true;
    if (t.includes(":")) {
        const z = stripIpv6Zone(t);
        if (serverSet.has(z) || serverSet.has(z.toLowerCase())) return true;
    }
    return false;
}

/**
 * @param {string[]} ips
 * @param {Set<string>} serverSet
 */
function htmlIpListWithServerHighlight(ips, serverSet) {
    if (!ips?.length) return "—";
    return ips
        .map(ip => {
            const esc = escapeHtml(ip);
            return ipMatchesServer(ip, serverSet)
                ? `<code class="mgmt-badge mgmt-badge-primary">${esc}</code>`
                : `<code>${esc}</code>`;
        })
        .join(", ");
}

/**
 * Server emits `[apex, wildcard]` pairs per configured apex (see `buildDnsReport`).
 * @param {object[]} rows
 * @returns {{ title: string, rows: object[] }[]}
 */
export function groupDnsRowsForSections(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const sections = [];
    for (let i = 0; i < list.length; i++) {
        const row = list[i];
        if (row.rowKind === "apex") {
            const chunk = [row];
            const next = list[i + 1];
            if (next?.rowKind === "wildcard") {
                chunk.push(next);
                i++;
            }
            sections.push({
                title: String(row.displayName || row.queryName || "Apex").trim() || "Apex",
                rows: chunk
            });
            continue;
        }
        if (sections.length === 0) {
            sections.push({ title: "Other", rows: [row] });
        } else {
            sections[sections.length - 1].rows.push(row);
        }
    }
    return sections;
}

/**
 * @param {object} row
 * @param {Set<string>} serverIpSet
 */
export function formatDnsReportRow(row, serverIpSet) {
    const v4Cell = htmlIpListWithServerHighlight(row.ipv4 || [], serverIpSet);
    const v6Cell = htmlIpListWithServerHighlight(row.ipv6 || [], serverIpSet);
    const errParts = (row.errors || []).filter(Boolean);
    const err = errParts.length ? errParts.join("; ") : "—";
    const pubm = [];
    if (row.matchesPublicIpv4) pubm.push("IPv4");
    if (row.matchesPublicIpv6) pubm.push("IPv6");
    const pubCell = pubm.length ? pubm.join(", ") : "—";
    const isWild = row.rowKind === "wildcard";
    const nameCell = isWild
        ? `<div class="mgmt-dns-name-cell"><code>${escapeHtml(row.displayName)}</code>
                            <div class="mgmt-dns-probe-line"><code class="mgmt-dns-probe-ghost">${escapeHtml(
                                row.queryName
                            )}</code><sup><a href="#mgmt-dns-fn-wild" class="mgmt-dns-fnref">1</a></sup></div></div>`
        : `<code>${escapeHtml(row.displayName)}</code>`;
    const queryCell = isWild ? "—" : `<code class="mgmt-network-query">${escapeHtml(row.queryName)}</code>`;
    return `<tr>
                        <td>${escapeHtml(row.label)}</td>
                        <td>${nameCell}</td>
                        <td>${queryCell}</td>
                        <td>${v4Cell}</td>
                        <td>${v6Cell}</td>
                        <td>${err === "—" ? "—" : escapeHtml(err)}</td>
                        <td>${escapeHtml(pubCell)}</td>
                    </tr>`;
}

let mgmtCollapsibleTableSeq = 0;

/**
 * Wraps a `mgmt-table-wrap` block: default collapsed (~8em); Expand / Collapse toggles full table.
 * @param {string} innerHtml - e.g. `<div class="mgmt-table-wrap">…</div>`
 */
export function wrapCollapsibleTable(innerHtml) {
    const id = `mgmt-coll-tbl-${++mgmtCollapsibleTableSeq}`;
    return `<div class="mgmt-table-collapsible mgmt-table-collapsed">
        <div class="mgmt-table-collapsible-bar">
            <button type="button" class="mgmt-btn mgmt-table-toggle" aria-expanded="false" aria-controls="${id}">Expand</button>
        </div>
        <div class="mgmt-table-collapsible-body" id="${id}">${innerHtml}</div>
    </div>`;
}

export function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export function formatDdnsIntervalMs(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "—";
    if (n % 3_600_000 === 0) return `${n / 3_600_000} h`;
    if (n % 60_000 === 0) return `${n / 60_000} min`;
    if (n % 1000 === 0) return `${n / 1000} s`;
    return `${n} ms`;
}

export function ddnsDomainSourceLabel(src) {
    if (src === "STORED_EXPLICIT") return "Saved settings (explicit zones)";
    if (src === "STORED_APEX") return "Saved settings (follow apex list)";
    if (src === "NONE") return "—";
    return String(src || "—");
}

export function ddnsSchedulerBlurb(data) {
    if (data.configInvalid) {
        return "Saved DDNS settings in SQLite are invalid. Update the form and save, or clear saved settings to turn DDNS off until you configure again.";
    }
    if (data.configSource === "none") {
        return "DDNS is not configured. Save settings below to store Porkbun credentials and options in SQLite.";
    }
    switch (data.schedulerState) {
        case "running":
            return "Saved settings are active; the scheduler reloads them each cycle (no server restart).";
        case "disabled":
            return "DDNS is turned off in saved settings. Enable below or clear saved settings to remove configuration.";
        case "missing_credentials":
            return "Saved settings are enabled but Porkbun API keys are missing—enter keys below (leave blank only when updating existing keys).";
        case "no_domains":
            return "No zones to sync—choose explicit domains or apex mode with apex domains configured on the Domains panel.";
        case "not_configured":
            return "No DDNS row in SQLite yet. Configure and save below.";
        default:
            return String(data.schedulerState);
    }
}
