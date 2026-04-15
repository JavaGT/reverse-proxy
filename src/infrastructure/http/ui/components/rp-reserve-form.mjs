import { apiFetch } from "../api-client.mjs";
import { escapeHtml } from "../formatters.mjs";

export class RpReserveForm extends HTMLElement {
    #boundOpen;

    connectedCallback() {
        this.innerHTML = `
            <rp-mgmt-modal id="reserve-modal" title="Add route">
                <form id="reserve-form">
                    <div class="mgmt-form-row">
                        <label for="r-sub">Subdomain</label>
                        <input type="text" id="r-sub" required pattern="[a-zA-Z0-9-]+" autocomplete="off" spellcheck="false" placeholder="e.g. app…">
                    </div>
                    <div class="mgmt-form-row">
                        <label for="r-base">Base domain</label>
                        <select id="r-base" required aria-required="true"></select>
                    </div>
                    <div class="mgmt-form-row">
                        <label for="r-ports">Port(s)</label>
                        <input type="text" id="r-ports" placeholder="3000 or 3000,3001…" required spellcheck="false">
                    </div>
                    <div class="mgmt-form-row">
                        <label for="r-health">Health path</label>
                        <input type="text" id="r-health" placeholder="Optional, e.g. /health…" spellcheck="false">
                    </div>
                </form>
                <div slot="footer">
                    <button type="button" class="mgmt-btn" id="reserve-cancel">Cancel</button>
                    <button type="submit" class="mgmt-btn mgmt-btn-primary" form="reserve-form">Save route</button>
                </div>
            </rp-mgmt-modal>`;

        const modal = this.querySelector("#reserve-modal");
        this.querySelector("#reserve-cancel")?.addEventListener("click", () => modal?.close());

        this.querySelector("#reserve-form")?.addEventListener("submit", e => this.#submit(e));

        this.#boundOpen = ev => {
            const d = ev.detail || {};
            this.#loadBases().then(() => {
                const form = this.querySelector("#reserve-form");
                const sub = this.querySelector("#r-sub");
                const base = this.querySelector("#r-base");
                const portIn = this.querySelector("#r-ports");
                const health = this.querySelector("#r-health");

                const isRouteEdit = d.subdomain != null;
                const isScanOnly = d.port != null && d.subdomain == null;

                if (isRouteEdit) {
                    sub.value = d.subdomain ?? "";
                    if (d.ports != null) {
                        portIn.value = Array.isArray(d.ports) ? d.ports.join(",") : String(d.ports);
                    }
                    health.value = d.healthPath ?? "";
                    modal?.setAttribute("title", "Edit route");
                } else if (isScanOnly) {
                    form?.reset();
                    portIn.value = String(d.port);
                    modal?.setAttribute("title", "Add route");
                } else {
                    form?.reset();
                    modal?.setAttribute("title", "Add route");
                }

                if (d.baseDomain != null && base) base.value = d.baseDomain;

                modal?.showModal();
                this.querySelector("#r-sub")?.focus();
            });
        };
        document.addEventListener("mgmt-open-reserve", this.#boundOpen);
        document.addEventListener("mgmt-refresh", () => this.#loadBases());
        this.#loadBases();
    }

    disconnectedCallback() {
        if (this.#boundOpen) document.removeEventListener("mgmt-open-reserve", this.#boundOpen);
    }

    async #loadBases() {
        const sel = this.querySelector("#r-base");
        if (!sel) return;
        try {
            const { data } = await apiFetch("/api/v1/domains");
            const list = data.apexDomains || [data.primary];
            sel.innerHTML = list.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
        } catch {
            sel.innerHTML = "<option value=\"\">(load failed)</option>";
        }
    }

    async #submit(e) {
        e.preventDefault();
        const modal = this.querySelector("#reserve-modal");
        const sub = this.querySelector("#r-sub")?.value.trim() ?? "";
        const baseDomain = this.querySelector("#r-base")?.value ?? "";
        const portsRaw = this.querySelector("#r-ports")?.value ?? "";
        const ports = portsRaw.split(",").map(s => parseInt(s.trim(), 10));
        const hp = this.querySelector("#r-health")?.value.trim() ?? "";
        if (ports.some(n => Number.isNaN(n))) {
            alert("Invalid port list.");
            return;
        }
        if (!baseDomain?.trim()) {
            alert("Choose a base domain.");
            return;
        }
        const body = { subdomain: sub, ports, baseDomain };
        if (hp) body.options = { healthPath: hp };
        try {
            await apiFetch("/api/v1/reserve", { method: "POST", body: JSON.stringify(body) });
            modal?.close();
            this.querySelector("#reserve-form")?.reset();
            await this.#loadBases();
            document.dispatchEvent(new CustomEvent("mgmt-refresh"));
        } catch (err) {
            alert(err.message);
        }
    }
}
