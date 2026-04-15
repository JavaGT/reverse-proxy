import { apiFetch } from "../api-client.mjs";
import { escapeHtml, wrapCollapsibleTable } from "../formatters.mjs";

export class RpScanPanel extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
            <rp-panel-toolbar heading="Port scanner"></rp-panel-toolbar>
            <p class="mgmt-p mgmt-muted">Looks for listening TCP ports in a range on <strong>this</strong> host. Narrow ranges finish faster; use results with <strong>Add route</strong> when you wire a hostname to a port.</p>
            <form id="scan-form" class="mgmt-scan-row">
                <input type="number" id="sc-start" class="mgmt-scan-input" value="3000" min="1" max="65535" required aria-label="Start port">
                <span class="mgmt-scan-sep" aria-hidden="true">–</span>
                <input type="number" id="sc-end" class="mgmt-scan-input" value="4000" min="1" max="65535" required aria-label="End port">
                <button type="submit" class="mgmt-btn mgmt-btn-primary">Scan ports</button>
            </form>
            <p class="mgmt-note" id="scan-status" aria-live="polite" role="status"></p>
            <div id="scan-out"></div>`;

        this.querySelector("#scan-form")?.addEventListener("submit", e => this.#run(e));
    }

    async #run(e) {
        e.preventDefault();
        const start = parseInt(this.querySelector("#sc-start")?.value, 10);
        const end = parseInt(this.querySelector("#sc-end")?.value, 10);
        const st = this.querySelector("#scan-status");
        const out = this.querySelector("#scan-out");
        st.textContent = "Scanning ports…";
        out.innerHTML = "";
        try {
            const { data } = await apiFetch("/api/v1/scan", {
                method: "POST",
                body: JSON.stringify({ start, end })
            });
            st.textContent = `Found ${data.openPorts.length} open port${data.openPorts.length === 1 ? "" : "s"}.`;
            if (!data.openPorts.length) {
                out.innerHTML =
                    "<p class=\"mgmt-p\">No open ports in this range. Try different start and end values, then run <strong>Scan ports</strong> again.</p>";
                return;
            }
            const rows = data.openPorts
                .map(
                    ({ port, process }) =>
                        `<tr><td>${port}</td><td><code>${escapeHtml(process.command)}</code></td><td>${escapeHtml(
                            String(process.pid)
                        )}</td>
                        <td class="mgmt-action-cell">
                            <button type="button" class="mgmt-btn sc-proxy" data-port="${port}" title="Open add-route flow for this port">Add route</button>
                        </td>
                        <td class="mgmt-action-cell">
                            <button type="button" class="mgmt-btn sc-kill" data-port="${port}" title="Terminate process listening on this port">Stop process</button>
                        </td></tr>`
                )
                .join("");
            out.innerHTML = wrapCollapsibleTable(`<div class="mgmt-table-wrap">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th rowspan="2">Port</th>
                                <th rowspan="2">Command</th>
                                <th rowspan="2">PID</th>
                                <th colspan="2" class="mgmt-th-actions">Actions</th>
                            </tr>
                            <tr>
                                <th class="mgmt-th-sub">Route</th>
                                <th class="mgmt-th-sub">Stop</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`);
            out.querySelectorAll(".sc-proxy").forEach(btn => {
                btn.addEventListener("click", () => {
                    const port = btn.getAttribute("data-port");
                    document.dispatchEvent(
                        new CustomEvent("mgmt-open-reserve", { detail: { port }, bubbles: true })
                    );
                });
            });
            out.querySelectorAll(".sc-kill").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const port = btn.getAttribute("data-port");
                    if (!confirm(`Kill process on port ${port}?`)) return;
                    try {
                        await apiFetch(`/api/v1/process/${port}`, { method: "DELETE" });
                        st.textContent = `Sent kill for port ${port}.`;
                    } catch (err) {
                        alert(err.message);
                    }
                });
            });
        } catch (err) {
            st.textContent = err.message;
        }
    }
}
