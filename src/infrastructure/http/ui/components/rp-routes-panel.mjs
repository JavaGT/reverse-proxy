import { apiFetch } from "../api-client.mjs";
import {
    escapeHtml,
    formatHealthCheckedAt,
    portsFromRouteTargets,
    subdomainFromRoute,
    wrapCollapsibleTable
} from "../formatters.mjs";

export class RpRoutesPanel extends HTMLElement {
    #onMgmtRefresh = () => this.render({ silent: false });
    #pollId = null;

    connectedCallback() {
        this.render({ silent: false });
        document.addEventListener("mgmt-refresh", this.#onMgmtRefresh);
        this.#pollId = setInterval(() => this.render({ silent: true }), 30_000);
    }

    disconnectedCallback() {
        document.removeEventListener("mgmt-refresh", this.#onMgmtRefresh);
        if (this.#pollId != null) clearInterval(this.#pollId);
    }

    async render(options = {}) {
        const silent = options.silent === true;
        if (!silent) {
            this.innerHTML = "<p class=\"mgmt-p mgmt-note\">Loading routes…</p>";
        }
        try {
            const { data: routes } = await apiFetch("/api/v1/routes");
            const toolbar = `
                <rp-panel-toolbar heading="Routes">
                    <button type="button" slot="actions" class="mgmt-btn mgmt-btn-primary" data-open-reserve>Add route</button>
                </rp-panel-toolbar>`;
            if (!routes.length) {
                this.innerHTML = `${toolbar}<p class=\"mgmt-p\">No routes.</p>`;
                this.#wireOpenReserve();
                return;
            }
            const rows = routes
                .map(route => {
                    const targets = (route.targets || [])
                        .map(t => `<code>${escapeHtml(t.url)}</code>`)
                        .join("<br>");
                    const healthPath = route.options?.healthPath;
                    const healthCell =
                        healthPath && String(healthPath).trim() !== ""
                            ? (route.targets || [])
                                  .map(t => {
                                      const ok = t.healthy !== false;
                                      const st = ok ? "up" : "down";
                                      const badgeClass = ok
                                          ? "mgmt-badge mgmt-badge-health-up"
                                          : "mgmt-badge mgmt-badge-health-down";
                                      const checked = formatHealthCheckedAt(t.healthCheckedAt);
                                      return `<div class="mgmt-health-block">
    <span class="${badgeClass}">${escapeHtml(st)}</span>
    <span class="mgmt-health-time">${escapeHtml(checked)}</span>
  </div>`;
                                  })
                                  .join("")
                            : `<span class="mgmt-note">Not monitored</span>`;
                    const sub = subdomainFromRoute(route);
                    const base = route.baseDomain || "";
                    const ports = portsFromRouteTargets(route);
                    const editPayload = encodeURIComponent(
                        JSON.stringify({
                            subdomain: sub,
                            baseDomain: base,
                            ports,
                            healthPath: route.options?.healthPath || ""
                        })
                    );
                    const editBtn =
                        route.type === "persistent"
                            ? `<button type="button" class="mgmt-btn route-edit" data-route="${editPayload}" title="Change ports or health check">Edit</button>`
                            : "—";
                    const deleteBtn =
                        route.type === "persistent"
                            ? `<button type="button" class="mgmt-btn route-delete" data-release="${escapeHtml(
                                  sub
                              )}" data-base="${escapeHtml(base)}" title="Remove this route">Delete</button>`
                            : "—";
                    return `<tr>
                        <td><code>${escapeHtml(route.host)}</code></td>
                        <td>${targets}</td>
                        <td>${escapeHtml(route.type)}</td>
                        <td><code>${escapeHtml(route.publicUrl || "")}</code></td>
                        <td class="mgmt-health-cell">${healthCell}</td>
                        <td class="mgmt-action-cell">${editBtn}</td>
                        <td class="mgmt-action-cell">${deleteBtn}</td>
                    </tr>`;
                })
                .join("");
            this.innerHTML = `
                ${toolbar}
                ${wrapCollapsibleTable(`<div class="mgmt-table-wrap">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th rowspan="2">Host</th>
                                <th rowspan="2">Targets</th>
                                <th rowspan="2">Type</th>
                                <th rowspan="2">Public URL</th>
                                <th rowspan="2">Health</th>
                                <th colspan="2" class="mgmt-th-actions">Actions</th>
                            </tr>
                            <tr>
                                <th class="mgmt-th-sub">Edit</th>
                                <th class="mgmt-th-sub">Delete</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`)}`;

            this.#wireOpenReserve();

            this.querySelectorAll(".route-edit").forEach(btn => {
                btn.addEventListener("click", () => {
                    const raw = btn.getAttribute("data-route");
                    if (!raw) return;
                    let detail;
                    try {
                        detail = JSON.parse(decodeURIComponent(raw));
                    } catch {
                        return;
                    }
                    document.dispatchEvent(new CustomEvent("mgmt-open-reserve", { detail, bubbles: true }));
                });
            });

            this.querySelectorAll(".route-delete").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const sub = btn.getAttribute("data-release");
                    const base = btn.getAttribute("data-base") || "";
                    if (!base) {
                        alert("This route has no apex on file; delete via the API with ?baseDomain=");
                        return;
                    }
                    if (!confirm(`Delete route ${sub}.${base}?`)) return;
                    try {
                        await apiFetch(
                            `/api/v1/reserve/${encodeURIComponent(sub)}?baseDomain=${encodeURIComponent(base)}`,
                            { method: "DELETE" }
                        );
                        document.dispatchEvent(new CustomEvent("mgmt-refresh"));
                    } catch (e) {
                        alert(e.message);
                    }
                });
            });
        } catch (e) {
            if (!silent) {
                this.innerHTML = `<p class="mgmt-p mgmt-note">Could not load routes: ${escapeHtml(e.message)}</p>`;
            }
        }
    }

    #wireOpenReserve() {
        this.querySelectorAll("[data-open-reserve]").forEach(btn => {
            btn.addEventListener("click", () => {
                document.dispatchEvent(new CustomEvent("mgmt-open-reserve", { detail: {}, bubbles: true }));
            });
        });
    }
}
