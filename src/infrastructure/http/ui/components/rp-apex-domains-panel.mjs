import { apiFetch } from "../api-client.mjs";
import { escapeHtml, wrapCollapsibleTable } from "../formatters.mjs";
import { isValidApexFQDN } from "/isValidApexFqdn.mjs";

/**
 * @param {string} defaultSel
 * @param {Record<string, string>} perApexSel
 * @returns {object | null}
 */
function buildDnsConsolePutPayload(defaultSel, perApexSel) {
    /** @type {Record<string, unknown>} */
    const out = {};
    if (defaultSel === "inherit") {
        /* omit defaultProvider — use DNS_CONSOLE_DEFAULT_PROVIDER / Settings */
    } else if (defaultSel === "none") {
        out.defaultProvider = "none";
    } else {
        out.defaultProvider = defaultSel;
    }
    /** @type {Record<string, string>} */
    const byApex = {};
    for (const [apex, sel] of Object.entries(perApexSel)) {
        if (sel === "inherit") continue;
        if (sel === "none") byApex[apex] = "none";
        else byApex[apex] = sel;
    }
    if (Object.keys(byApex).length) out.byApex = byApex;
    if (Object.keys(out).length === 0) return null;
    return out;
}

/**
 * @param {object | null | undefined} dc
 * @returns {string}
 */
function defaultDnsConsoleSelectValue(dc) {
    if (!dc || dc.defaultProvider == null || dc.defaultProvider === "") return "inherit";
    const t = String(dc.defaultProvider).trim().toLowerCase();
    if (t === "none") return "none";
    return t;
}

/**
 * @param {object | null | undefined} dc
 * @param {string} apex
 * @returns {string}
 */
function apexDnsConsoleSelectValue(dc, apex) {
    const b = dc?.byApex && typeof dc.byApex === "object" ? dc.byApex : {};
    if (!Object.prototype.hasOwnProperty.call(b, apex)) return "inherit";
    const v = b[apex];
    if (v === null || v === "" || v === "none") return "none";
    return String(v).trim().toLowerCase();
}

/**
 * @param {Set<string>} ids
 * @param {string} selected
 * @param {boolean} forDefault
 * @returns {string}
 */
function providerSelectOptionsHtml(ids, selected, forDefault) {
    const inheritLabel = forDefault
        ? "Inherit (Settings → DNS console default provider, or .env DNS_CONSOLE_DEFAULT_PROVIDER)"
        : "Inherit (use default above)";
    const parts = [
        `<option value="inherit" ${selected === "inherit" ? "selected" : ""}>${escapeHtml(inheritLabel)}</option>`,
        `<option value="none" ${selected === "none" ? "selected" : ""}>None (no link)</option>`
    ];
    const sorted = [...ids].sort();
    for (const id of sorted) {
        parts.push(
            `<option value="${escapeHtml(id)}" ${selected === id ? "selected" : ""}>${escapeHtml(id)}</option>`
        );
    }
    return parts.join("");
}

export class RpApexDomainsPanel extends HTMLElement {
    /** @type {object | null} */
    #data = null;

    connectedCallback() {
        this.render();
        document.addEventListener("mgmt-refresh", () => this.render());
    }

    /**
     * @param {string[] | undefined} apexList - omit keys for apexes not in this list (stale DOM rows after delete)
     * @returns {object | null}
     */
    #collectDnsConsolePayload(apexList) {
        const list = apexList ?? this.#data?.apexDomains ?? [];
        const defaultSel = this.querySelector("#dns-console-default")?.value ?? "inherit";
        /** @type {Record<string, string>} */
        const per = {};
        for (const apex of list) {
            const sel = this.querySelector(`select[data-dns-apex="${apex}"]`);
            per[apex] = sel?.value ?? "inherit";
        }
        return buildDnsConsolePutPayload(defaultSel, per);
    }

    async #putDomains(apexDomains, dnsConsole) {
        await apiFetch("/api/v1/domains", {
            method: "PUT",
            body: JSON.stringify({ apexDomains, dnsConsole })
        });
    }

    async render() {
        this.innerHTML = "<p class=\"mgmt-p mgmt-note\">Loading…</p>";
        try {
            const { data } = await apiFetch("/api/v1/domains");
            this.#data = data;
            const linkByApex = new Map((data.dnsConsoleLinks || []).map(l => [l.apex, l]));
            const providerIds = data.dnsConsoleProviderIds || [];
            const idSet = new Set(providerIds.map(String));
            const defVal = defaultDnsConsoleSelectValue(data.dnsConsole);
            if (defVal !== "inherit" && defVal !== "none" && !idSet.has(defVal)) idSet.add(defVal);

            const rows = (data.apexDomains || [])
                .map(apex => {
                    const link = linkByApex.get(apex);
                    const dnsCell = link
                        ? `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                              link.label
                          )}</a>`
                        : "—";
                    const ov = apexDnsConsoleSelectValue(data.dnsConsole, apex);
                    const rowIds = new Set(idSet);
                    if (ov !== "inherit" && ov !== "none" && !rowIds.has(ov)) rowIds.add(ov);
                    const overrideHtml = `<select class="mgmt-input" data-dns-apex="${escapeHtml(apex)}" aria-label="DNS console override for ${escapeHtml(
                        apex
                    )}">${providerSelectOptionsHtml(rowIds, ov, false)}</select>`;
                    const badge =
                        apex === data.primary
                            ? `<span class="mgmt-badge mgmt-badge-primary">primary</span>`
                            : `<span class="mgmt-badge">secondary</span>`;
                    return `<tr>
                        <td><code>${escapeHtml(apex)}</code></td>
                        <td>${badge}</td>
                        <td>${dnsCell}</td>
                        <td>${overrideHtml}</td>
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

            const defaultSelectHtml = providerSelectOptionsHtml(idSet, defVal, true);

            this.innerHTML = `
                <rp-panel-toolbar heading="Apex domains">
                    <button type="button" slot="actions" class="mgmt-btn mgmt-btn-primary" id="apex-btn-add">Add domain</button>
                </rp-panel-toolbar>
                <p class="mgmt-p">Each reservation names an apex via <code>baseDomain</code>. Saving changes writes SQLite and overrides <code>ROOT_DOMAINS</code> until changed again.</p>
                <h3 class="mgmt-h3">DNS management console links</h3>
                <p class="mgmt-p mgmt-note">Opens your registrar’s DNS page per apex (e.g. Porkbun). Resolution order: <strong>per-apex override</strong> → <strong>default below</strong> → <strong>Settings</strong> (<code>dnsConsoleDefaultProvider</code> / SQLite) → <code>.env</code> <code>DNS_CONSOLE_DEFAULT_PROVIDER</code>. DDNS (API keys, sync) is configured on the <a href="ddns.html">DDNS</a> page.</p>
                <div class="mgmt-form-row">
                    <label for="dns-console-default">Default registrar / console</label>
                    <select id="dns-console-default" class="mgmt-input">${defaultSelectHtml}</select>
                </div>
                <div class="mgmt-form-actions mgmt-dns-console-actions">
                    <button type="button" class="mgmt-btn mgmt-btn-primary" id="dns-console-save">Save DNS console settings</button>
                    <button type="button" class="mgmt-btn" id="dns-console-clear" title="Remove stored dnsConsole; fall back to Settings / .env only">Clear stored console config</button>
                </div>
                <p id="dns-console-status" class="mgmt-p mgmt-note" role="status" aria-live="polite"></p>
                ${wrapCollapsibleTable(`<div class="mgmt-table-wrap">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th>Apex</th>
                                <th>Role</th>
                                <th>Resolved link</th>
                                <th>Override</th>
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
            const dnsStatus = this.querySelector("#dns-console-status");

            this.querySelector("#dns-console-save")?.addEventListener("click", async () => {
                if (!this.#data?.apexDomains) return;
                if (dnsStatus) dnsStatus.textContent = "Saving…";
                try {
                    await this.#putDomains([...this.#data.apexDomains], this.#collectDnsConsolePayload(this.#data.apexDomains));
                    if (dnsStatus) dnsStatus.textContent = "Saved.";
                    document.dispatchEvent(new CustomEvent("mgmt-refresh"));
                } catch (err) {
                    if (dnsStatus) dnsStatus.textContent = err.message;
                    alert(err.message);
                }
            });

            this.querySelector("#dns-console-clear")?.addEventListener("click", async () => {
                if (!this.#data?.apexDomains) return;
                if (!confirm("Remove dnsConsole from SQLite? Console links will use only Settings / .env until you configure again.")) {
                    return;
                }
                if (dnsStatus) dnsStatus.textContent = "Saving…";
                try {
                    await this.#putDomains([...this.#data.apexDomains], null);
                    if (dnsStatus) dnsStatus.textContent = "Cleared.";
                    document.dispatchEvent(new CustomEvent("mgmt-refresh"));
                } catch (err) {
                    if (dnsStatus) dnsStatus.textContent = err.message;
                    alert(err.message);
                }
            });

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
                    await this.#putDomains(cur, this.#collectDnsConsolePayload(cur));
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
                    await this.#putDomains(next, this.#collectDnsConsolePayload(next));
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
