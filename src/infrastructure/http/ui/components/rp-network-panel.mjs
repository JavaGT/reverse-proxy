import { apiFetch } from "../api-client.mjs";
import {
    buildServerIpSet,
    escapeHtml,
    formatDnsReportRow,
    groupDnsRowsForSections,
    wrapCollapsibleTable
} from "../formatters.mjs";

export class RpNetworkPanel extends HTMLElement {
    #onMgmtRefresh = () => this.render({ silent: false });
    #pollId = null;

    connectedCallback() {
        this.render({ silent: false });
        document.addEventListener("mgmt-refresh", this.#onMgmtRefresh);
        this.#pollId = setInterval(() => this.render({ silent: true }), 45_000);
    }

    disconnectedCallback() {
        document.removeEventListener("mgmt-refresh", this.#onMgmtRefresh);
        if (this.#pollId != null) clearInterval(this.#pollId);
    }

    async render(options = {}) {
        const silent = options.silent === true;
        if (!silent) {
            this.innerHTML = "<p class=\"mgmt-p mgmt-note\">Loading network &amp; DNS…</p>";
        }
        try {
            const { data } = await apiFetch("/api/v1/network");
            const pub = data.publicIp || {};
            const serverIpSet = buildServerIpSet(data);

            const localRows = (data.localAddresses || [])
                .map(
                    a =>
                        `<tr><td><code>${escapeHtml(a.interface)}</code></td><td>${escapeHtml(a.family)}</td><td>${
                            a.internal ? "yes" : "no"
                        }</td><td><code class="mgmt-badge mgmt-badge-primary">${escapeHtml(a.address)}</code></td></tr>`
                )
                .join("");

            const dnsRowsList = data.dns?.rows || [];
            const dnsHasWildcard = dnsRowsList.some(r => r.rowKind === "wildcard");
            const dnsSections = groupDnsRowsForSections(dnsRowsList);
            const dnsRows =
                dnsSections.length === 0
                    ? '<tr><td colspan="7">No apex domains in this snapshot.</td></tr>'
                    : dnsSections
                          .map(
                              sec =>
                                  `<tr class="mgmt-dns-section-head"><th colspan="7" scope="colgroup" class="mgmt-dns-section-title-cell"><span class="mgmt-dns-section-title">${escapeHtml(
                                      sec.title
                                  )}</span></th></tr>${sec.rows.map(r => formatDnsReportRow(r, serverIpSet)).join("")}`
                          )
                          .join("");
            const dnsFoot = dnsHasWildcard
                ? `<tfoot><tr><td colspan="7" class="mgmt-dns-footnote" id="mgmt-dns-fn-wild"><sup class="mgmt-dns-fn-mark">1</sup> One-off hostname used for this scan only. If it resolves, a wildcard or an explicit record exists for that name.</td></tr></tfoot>`
                : "";

            const gen = data.generatedAt
                ? `<p class="mgmt-p mgmt-note">Generated: <time datetime="${escapeHtml(data.generatedAt)}">${escapeHtml(
                      data.generatedAt
                  )}</time></p>`
                : "";

            const pic = data.publicIngressSelfCheck || {};
            const probePort = pic.port ?? 443;
            const formatIngressRow = (label, result) => {
                if (!result) {
                    return `<tr><th scope="row">${label}</th><td><code>—</code> <span class="mgmt-muted">(no public ${label} detected)</span></td></tr>`;
                }
                const st = result.statusCode != null ? `HTTP ${result.statusCode}` : "—";
                const ok = result.ok ? "yes" : "no";
                const u = result.url ? escapeHtml(result.url) : "—";
                const errTail =
                    result.ok && !result.error
                        ? ""
                        : `<br><span class="mgmt-muted">Error: ${escapeHtml(result.error || "—")}</span>`;
                return `<tr><th scope="row">${label}</th><td><strong>${escapeHtml(ok)}</strong> · ${escapeHtml(
                    st
                )} · <code>${u}</code>${errTail}</td></tr>`;
            };
            const ingressSelfCheckTable = `<div class="mgmt-table-wrap">
                    <table class="mgmt-table mgmt-network-meta">
                        <tbody>
                            <tr><th scope="row">Probe port</th><td><code>${escapeHtml(String(probePort))}</code></td></tr>
                            ${formatIngressRow("IPv4", pic.ipv4)}
                            ${formatIngressRow("IPv6", pic.ipv6)}
                        </tbody>
                    </table>
                </div>`;

            this.innerHTML = `
                <rp-panel-toolbar heading="Network &amp; DNS"></rp-panel-toolbar>
                <p class="mgmt-p mgmt-note">Public IP, local interfaces, and DNS (apex + catch-all probes). Route hostnames stay under Routes. <button type="button" class="mgmt-inline-help" data-open-help>Help</button></p>
                ${gen}
                <h3 class="mgmt-h3">Public IP (Internet)</h3>
                ${wrapCollapsibleTable(`<div class="mgmt-table-wrap">
                    <table class="mgmt-table mgmt-network-meta">
                        <tbody>
                            <tr><th scope="row">IPv4</th><td>${
                                pub.ipv4
                                    ? `<code class="mgmt-badge mgmt-badge-primary">${escapeHtml(pub.ipv4)}</code>`
                                    : `<code>—</code>`
                            }</td></tr>
                            <tr><th scope="row">IPv6</th><td>${
                                pub.ipv6
                                    ? `<code class="mgmt-badge mgmt-badge-primary">${escapeHtml(pub.ipv6)}</code>`
                                    : `<code>—</code>`
                            }</td></tr>
                        </tbody>
                    </table>
                </div>`)}
                ${
                    data.cgnatNote
                        ? `<p class="mgmt-p mgmt-note">${escapeHtml(data.cgnatNote)}</p>`
                        : ""
                }
                <details class="mgmt-details">
                    <summary>Advanced: public ingress self-check (port forward / hairpin)</summary>
                    <div class="mgmt-details-body">
                        <p class="mgmt-p mgmt-note" style="margin-top:0">The server runs <code>GET</code> against its own public IPv4/IPv6 over HTTPS (port <code>${escapeHtml(
                            String(probePort)
                        )}</code>; tune with <code>PUBLIC_INGRESS_PROBE_HTTPS_PORT</code> / <code>PUBLIC_INGRESS_PROBE_TIMEOUT_MS</code>). Certificate validation is skipped for this probe only. Any completed TLS response (including HTTP 404 from this proxy) counts as reachable.</p>
                        ${ingressSelfCheckTable}
                        <p class="mgmt-p mgmt-note">If this fails but services work from cellular data, hairpin NAT may be off. If no public IPv4 appears above, see any CGNAT note.</p>
                    </div>
                </details>
                <h3 class="mgmt-h3">Local addresses</h3>
                ${wrapCollapsibleTable(`<div class="mgmt-table-wrap">
                    <table class="mgmt-table">
                        <thead>
                            <tr><th>Interface</th><th>Family</th><th>Internal</th><th>Address</th></tr>
                        </thead>
                        <tbody>${localRows || '<tr><td colspan="4">None</td></tr>'}</tbody>
                    </table>
                </div>`)}
                <h3 class="mgmt-h3">DNS resolution</h3>
                ${wrapCollapsibleTable(`<div class="mgmt-table-wrap">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th>Kind</th>
                                <th>Name</th>
                                <th>Query</th>
                                <th>A</th>
                                <th>AAAA</th>
                                <th>Errors</th>
                                <th>Matches public</th>
                            </tr>
                        </thead>
                        <tbody>${dnsRows}</tbody>
                        ${dnsFoot}
                    </table>
                </div>`)}`;
        } catch (e) {
            if (!silent) {
                this.innerHTML = `<p class="mgmt-p mgmt-note">Could not load network status: ${escapeHtml(e.message)}</p>`;
            }
        }
    }
}
