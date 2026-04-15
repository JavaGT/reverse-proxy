import { apiFetch } from "../api-client.mjs";
import { escapeHtml, wrapCollapsibleTable } from "../formatters.mjs";
import { isValidApexFQDN } from "/isValidApexFqdn.mjs";

export class RpApexDomainsPanel extends HTMLElement {
    #data = null;

    connectedCallback() {
        this.render();
        document.addEventListener("mgmt-refresh", () => this.render());
    }

    async render() {
        this.innerHTML = "<p class=\"mgmt-p mgmt-note\">Loading…</p>";
        try {
            const { data } = await apiFetch("/api/v1/domains");
            this.#data = data;
            const linkByApex = new Map((data.dnsConsoleLinks || []).map(l => [l.apex, l]));
            const rows = (data.apexDomains || [])
                .map(apex => {
                    const link = linkByApex.get(apex);
                    const dnsCell = link
                        ? `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                              link.label
                          )}</a>`
                        : "—";
                    const badge =
                        apex === data.primary
                            ? `<span class="mgmt-badge mgmt-badge-primary">primary</span>`
                            : `<span class="mgmt-badge">secondary</span>`;
                    return `<tr>
                        <td><code>${escapeHtml(apex)}</code></td>
                        <td>${badge}</td>
                        <td>${dnsCell}</td>
                        <td class="mgmt-action-cell">
                            <button type="button" class="mgmt-btn apex-remove" data-apex="${escapeHtml(apex)}" ${
                        data.apexDomains.length <= 1
                            ? "disabled title=\"At least one apex required\""
                            : "title=\"Remove this apex\""
                    }>Delete</button>
                        </td>
                    </tr>`;
                })
                .join("");

            this.innerHTML = `
                <rp-panel-toolbar heading="Apex domains">
                    <button type="button" slot="actions" class="mgmt-btn mgmt-btn-primary" id="apex-btn-add">Add domain</button>
                </rp-panel-toolbar>
                <p class="mgmt-p">Each reservation names an apex via <code>baseDomain</code>. Saving changes writes SQLite and overrides <code>ROOT_DOMAINS</code> until changed again.</p>
                ${wrapCollapsibleTable(`<div class="mgmt-table-wrap">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th>Apex</th>
                                <th>Role</th>
                                <th>DNS console</th>
                                <th class="mgmt-th-actions">Delete</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`)}
                <rp-mgmt-modal id="apex-modal-add" title="Add apex domain">
                    <form id="apex-form-add">
                        <div class="mgmt-form-row">
                            <label for="apex-in-add">Domain</label>
                            <input type="text" id="apex-in-add" class="mgmt-in-add" required placeholder="e.g. example.com" autocomplete="off" spellcheck="false">
                        </div>
                        <p class="mgmt-note">Appends to the list. Primary stays the current first apex until you remove it or change order via the API.</p>
                    </form>
                    <div slot="footer">
                        <button type="button" class="mgmt-btn" id="apex-add-cancel">Cancel</button>
                        <button type="submit" class="mgmt-btn mgmt-btn-primary" form="apex-form-add">Add</button>
                    </div>
                </rp-mgmt-modal>
                <rp-mgmt-modal id="apex-modal-remove" title="Delete apex domain">
                    <p class="mgmt-p" id="apex-remove-msg"></p>
                    <div slot="footer">
                        <button type="button" class="mgmt-btn" id="apex-remove-cancel">Cancel</button>
                        <button type="button" class="mgmt-btn mgmt-btn-primary" id="apex-remove-confirm">Delete</button>
                    </div>
                </rp-mgmt-modal>`;

            const modalAdd = this.querySelector("#apex-modal-add");
            const modalRm = this.querySelector("#apex-modal-remove");

            this.querySelector("#apex-btn-add")?.addEventListener("click", () => {
                const inp = this.querySelector("#apex-in-add");
                if (inp) inp.value = "";
                modalAdd?.showModal();
            });

            this.querySelector("#apex-add-cancel")?.addEventListener("click", () => modalAdd?.close());

            this.querySelector("#apex-form-add")?.addEventListener("submit", async e => {
                e.preventDefault();
                const raw = this.querySelector("#apex-in-add")?.value?.trim() ?? "";
                if (!isValidApexFQDN(raw)) {
                    alert("Invalid apex domain.");
                    return;
                }
                const apex = raw.toLowerCase();
                const cur = [...(data.apexDomains || [])];
                if (cur.includes(apex)) {
                    alert("That apex is already in the list.");
                    return;
                }
                cur.push(apex);
                try {
                    await apiFetch("/api/v1/domains", {
                        method: "PUT",
                        body: JSON.stringify({ apexDomains: cur, dnsConsole: data.dnsConsole ?? null })
                    });
                    modalAdd?.close();
                    document.dispatchEvent(new CustomEvent("mgmt-refresh"));
                } catch (err) {
                    alert(err.message);
                }
            });

            let removeTarget = null;
            this.querySelectorAll(".apex-remove").forEach(btn => {
                btn.addEventListener("click", () => {
                    const apex = btn.getAttribute("data-apex");
                    if (!apex || data.apexDomains.length <= 1) return;
                    removeTarget = apex;
                    const p = this.querySelector("#apex-remove-msg");
                    if (p) p.textContent = `Delete ${apex} from this instance? Routes under it must be gone or the save will fail.`;
                    modalRm?.showModal();
                });
            });

            this.querySelector("#apex-remove-cancel")?.addEventListener("click", () => {
                removeTarget = null;
                modalRm?.close();
            });

            this.querySelector("#apex-remove-confirm")?.addEventListener("click", async () => {
                if (!removeTarget) return;
                const next = (data.apexDomains || []).filter(a => a !== removeTarget);
                try {
                    await apiFetch("/api/v1/domains", {
                        method: "PUT",
                        body: JSON.stringify({
                            apexDomains: next,
                            dnsConsole: data.dnsConsole ?? null
                        })
                    });
                    removeTarget = null;
                    modalRm?.close();
                    document.dispatchEvent(new CustomEvent("mgmt-refresh"));
                } catch (err) {
                    alert(err.message);
                }
            });
        } catch (e) {
            this.innerHTML = `<p class="mgmt-p mgmt-note">Could not load domains: ${escapeHtml(e.message)}</p>`;
        }
    }
}
