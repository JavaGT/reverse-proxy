import { apiFetch } from "../api-client.mjs";
import {
    ddnsDomainSourceLabel,
    ddnsSchedulerBlurb,
    escapeHtml,
    formatDdnsIntervalMs,
    wrapCollapsibleTable
} from "../formatters.mjs";

const DEFAULT_PORKBUN_API_BASE = "https://api.porkbun.com/api/json/v3";

export class RpDdnsPanel extends HTMLElement {
    #onMgmtRefresh = () => this.render({ silent: false });

    connectedCallback() {
        this.render({ silent: false });
        document.addEventListener("mgmt-refresh", this.#onMgmtRefresh);
    }

    disconnectedCallback() {
        document.removeEventListener("mgmt-refresh", this.#onMgmtRefresh);
    }

    #linesFromTextarea(raw) {
        return String(raw ?? "")
            .split(/[\r\n]+/)
            .map(s => s.trim())
            .filter(Boolean);
    }

    #buildPutBody() {
        const enabled = this.querySelector("#ddns-enabled")?.checked ?? false;
        const domainMode =
            this.querySelector('input[name="ddns-domain-mode"]:checked')?.value === "explicit" ? "explicit" : "apex";
        const domainsRaw = this.querySelector("#ddns-domains")?.value ?? "";
        const domains = domainsRaw
            .split(/[\s,]+/)
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
        const matchNote = this.querySelector("#ddns-match")?.value?.trim() ?? "";
        const intervalMs = parseInt(this.querySelector("#ddns-interval")?.value ?? "", 10);
        const ipLookupTimeoutMs = parseInt(this.querySelector("#ddns-ip-timeout")?.value ?? "", 10);
        const apiKey = this.querySelector("#ddns-api-key")?.value?.trim() ?? "";
        const secretKey = this.querySelector("#ddns-secret-key")?.value?.trim() ?? "";

        const body = {
            enabled,
            domainMode,
            matchNote: matchNote.length ? matchNote : undefined,
            intervalMs: Number.isInteger(intervalMs) ? intervalMs : undefined,
            ipLookupTimeoutMs: Number.isInteger(ipLookupTimeoutMs) ? ipLookupTimeoutMs : undefined
        };
        if (domainMode === "explicit") body.domains = domains;
        if (apiKey) body.porkbunApiKey = apiKey;
        if (secretKey) body.porkbunSecretKey = secretKey;

        const v4lines = this.#linesFromTextarea(this.querySelector("#ddns-ipv4-services")?.value ?? "");
        if (v4lines.length) body.ipv4Services = v4lines;
        const v6lines = this.#linesFromTextarea(this.querySelector("#ddns-ipv6-services")?.value ?? "");
        if (v6lines.length) body.ipv6Services = v6lines;
        const apiBase = this.querySelector("#ddns-api-base")?.value?.trim() ?? "";
        if (apiBase) body.porkbunApiBaseUrl = apiBase;

        return body;
    }

    #wire() {
        const form = this.querySelector("#ddns-form");
        const st = this.querySelector("#ddns-form-status");
        const modeRadios = this.querySelectorAll('input[name="ddns-domain-mode"]');
        const domainsRow = this.querySelector("#ddns-domains-row");

        const syncDomainRow = () => {
            const explicit = this.querySelector('input[name="ddns-domain-mode"][value="explicit"]')?.checked;
            if (domainsRow) domainsRow.style.display = explicit ? "" : "none";
        };
        modeRadios.forEach(r => r.addEventListener("change", syncDomainRow));
        syncDomainRow();

        form?.addEventListener("submit", async e => {
            e.preventDefault();
            if (st) st.textContent = "Saving…";
            try {
                const body = this.#buildPutBody();
                await apiFetch("/api/v1/ddns", { method: "PUT", body: JSON.stringify(body) });
                if (st) st.textContent = "Saved.";
                document.dispatchEvent(new CustomEvent("mgmt-refresh"));
            } catch (err) {
                if (st) st.textContent = err.message;
                alert(err.message);
            }
        });

        this.querySelector("#ddns-clear")?.addEventListener("click", async () => {
            if (!confirm("Remove saved DDNS configuration from SQLite? DDNS stays off until you save settings again.")) return;
            if (st) st.textContent = "Clearing…";
            try {
                await apiFetch("/api/v1/ddns", { method: "DELETE" });
                if (st) st.textContent = "Cleared saved settings.";
                document.dispatchEvent(new CustomEvent("mgmt-refresh"));
            } catch (err) {
                if (st) st.textContent = err.message;
                alert(err.message);
            }
        });
    }

    async render(options = {}) {
        const silent = options.silent === true;
        if (!silent) {
            this.innerHTML = "<p class=\"mgmt-p mgmt-note\">Loading DDNS settings…</p>";
        }
        try {
            const { data } = await apiFetch("/api/v1/ddns");
            const cached = data.cachedPublicIp;
            const cachedV4 = cached?.ipv4 ? escapeHtml(cached.ipv4) : "—";
            const cachedV6 = cached?.ipv6 ? escapeHtml(cached.ipv6) : "—";
            const zones =
                (data.domains || []).length > 0
                    ? (data.domains || []).map(z => `<code>${escapeHtml(z)}</code>`).join(", ")
                    : "—";
            const cred = data.credentialsConfigured ? "configured" : "not set";
            const stateLabel = escapeHtml(data.schedulerState || "");
            const cfgSrc = escapeHtml(data.configSource || "none");
            const explicitChecked = data.domainMode === "explicit" ? "checked" : "";
            const apexChecked = data.domainMode !== "explicit" ? "checked" : "";
            const domainsValue =
                data.domainMode === "explicit" && Array.isArray(data.domains) ? data.domains.join("\n") : "";
            const v4List = Array.isArray(data.ipv4Services) ? data.ipv4Services : [];
            const v6List = Array.isArray(data.ipv6Services) ? data.ipv6Services : [];
            const ipv4Textarea = escapeHtml(v4List.join("\n"));
            const ipv6Textarea = escapeHtml(v6List.join("\n"));
            const apiBaseVal = escapeHtml(
                typeof data.porkbunApiBaseUrl === "string" && data.porkbunApiBaseUrl
                    ? data.porkbunApiBaseUrl
                    : DEFAULT_PORKBUN_API_BASE
            );
            const discoverySummary = `${v4List.length} IPv4 · ${v6List.length} IPv6 URLs`;

            const advancedBlock = `
                <h3 class="mgmt-h3">Advanced</h3>
                <p class="mgmt-p mgmt-note">Optional overrides. Leave discovery lists empty when saving to keep existing URLs (or defaults if this is the first save).</p>
                <div class="mgmt-form-row">
                    <label for="ddns-api-base">Porkbun API base URL</label>
                    <input type="url" id="ddns-api-base" class="mgmt-input" placeholder="${escapeHtml(
                DEFAULT_PORKBUN_API_BASE
            )}" value="${apiBaseVal}">
                </div>
                <div class="mgmt-form-row">
                    <label for="ddns-ipv4-services">IPv4 discovery URLs (one per line)</label>
                    <textarea id="ddns-ipv4-services" rows="4" class="mgmt-textarea" spellcheck="false">${ipv4Textarea}</textarea>
                </div>
                <div class="mgmt-form-row">
                    <label for="ddns-ipv6-services">IPv6 discovery URLs (one per line)</label>
                    <textarea id="ddns-ipv6-services" rows="4" class="mgmt-textarea" spellcheck="false">${ipv6Textarea}</textarea>
                </div>`;

            this.innerHTML = `
                <rp-panel-toolbar heading="DDNS (Porkbun)"></rp-panel-toolbar>
                <p class="mgmt-p mgmt-note">${escapeHtml(ddnsSchedulerBlurb(data))} Compare with <a href="index.html#network">Network</a> for live public IP and DNS.</p>
                ${wrapCollapsibleTable(`<div class="mgmt-table-wrap">
                    <table class="mgmt-table mgmt-network-meta">
                        <tbody>
                            <tr><th scope="row">Config source</th><td><code>${cfgSrc}</code></td></tr>
                            <tr><th scope="row">Scheduler</th><td><code>${stateLabel}</code> · ${
                                data.schedulerWouldRun ? "active" : "idle"
                            }</td></tr>
                            <tr><th scope="row">Enabled</th><td>${data.enabled ? "yes" : "no"}</td></tr>
                            <tr><th scope="row">Credentials</th><td>${escapeHtml(cred)}</td></tr>
                            <tr><th scope="row">Zones</th><td>${zones}</td></tr>
                            <tr><th scope="row">Zone source</th><td>${escapeHtml(ddnsDomainSourceLabel(data.domainListSource))}</td></tr>
                            <tr><th scope="row">Match note</th><td><code>${escapeHtml(data.matchNote || "")}</code></td></tr>
                            <tr><th scope="row">Interval</th><td>${escapeHtml(formatDdnsIntervalMs(data.intervalMs))} (${escapeHtml(
                String(data.intervalMs ?? "")
            )} ms)</td></tr>
                            <tr><th scope="row">IP lookup timeout</th><td>${escapeHtml(String(data.ipLookupTimeoutMs ?? ""))} ms</td></tr>
                            <tr><th scope="row">Porkbun API base</th><td><code>${escapeHtml(
                data.porkbunApiBaseUrl || DEFAULT_PORKBUN_API_BASE
            )}</code></td></tr>
                            <tr><th scope="row">Discovery URLs</th><td>${escapeHtml(discoverySummary)}</td></tr>
                            <tr><th scope="row">Cached public IPv4</th><td>${cachedV4}</td></tr>
                            <tr><th scope="row">Cached public IPv6</th><td>${cachedV6}</td></tr>
                        </tbody>
                    </table>
                </div>`)}
                <h3 class="mgmt-h3">Edit settings</h3>
                <p class="mgmt-p mgmt-note">Saves to SQLite on the server (includes API secrets in the database). Omit key fields when updating to keep existing keys. Requires bearer token when <code>MANAGEMENT_SECRET</code> is set.</p>
                <form id="ddns-form" class="mgmt-ddns-form">
                    <div class="mgmt-form-row mgmt-form-row-check">
                        <label><input type="checkbox" id="ddns-enabled" ${data.enabled ? "checked" : ""}> Enable DDNS</label>
                    </div>
                    <div class="mgmt-form-row">
                        <label for="ddns-api-key">Porkbun API key</label>
                        <input type="password" id="ddns-api-key" autocomplete="off" placeholder="unchanged if empty">
                    </div>
                    <div class="mgmt-form-row">
                        <label for="ddns-secret-key">Porkbun secret key</label>
                        <input type="password" id="ddns-secret-key" autocomplete="off" placeholder="unchanged if empty">
                    </div>
                    <fieldset class="mgmt-fieldset">
                        <legend class="mgmt-legend">Zones</legend>
                        <label class="mgmt-radio-line"><input type="radio" name="ddns-domain-mode" value="apex" ${apexChecked}> Use configured apex domains (Domains panel / SQLite)</label>
                        <label class="mgmt-radio-line"><input type="radio" name="ddns-domain-mode" value="explicit" ${explicitChecked}> Explicit apex list</label>
                    </fieldset>
                    <div class="mgmt-form-row" id="ddns-domains-row">
                        <label for="ddns-domains">Domains (one per line or comma-separated)</label>
                        <textarea id="ddns-domains" rows="3" class="mgmt-textarea" placeholder="example.com">${escapeHtml(
                domainsValue
            )}</textarea>
                    </div>
                    <div class="mgmt-form-row">
                        <label for="ddns-match">Match note</label>
                        <input type="text" id="ddns-match" value="${escapeHtml(data.matchNote || "")}" required maxlength="512">
                    </div>
                    <p class="mgmt-note mgmt-ddns-match-hint">Porkbun stores a <strong>notes</strong> string on each DNS record. This reverse proxy only updates <strong>A</strong> and <strong>AAAA</strong> records whose <strong>notes</strong> field is <em>exactly</em> this value; other records are never touched. Use a dedicated tag (for example the default <code>match:reverse-proxy-ddns</code>) so DDNS does not overwrite rows you manage elsewhere.</p>
                    <div class="mgmt-form-row">
                        <label for="ddns-interval">Interval (ms)</label>
                        <input type="number" id="ddns-interval" min="10000" max="86400000" step="1000" value="${escapeHtml(
                String(data.intervalMs ?? 300000)
            )}" required>
                    </div>
                    <div class="mgmt-form-row">
                        <label for="ddns-ip-timeout">IP lookup timeout (ms)</label>
                        <input type="number" id="ddns-ip-timeout" min="1000" max="120000" step="500" value="${escapeHtml(
                String(data.ipLookupTimeoutMs ?? 8000)
            )}" required>
                    </div>
                    ${wrapCollapsibleTable(`<div class="mgmt-ddns-advanced-inner">${advancedBlock}</div>`)}
                    <p class="mgmt-note" id="ddns-form-status" aria-live="polite"></p>
                    <div class="mgmt-form-actions">
                        <button type="submit" class="mgmt-btn mgmt-btn-primary">Save to SQLite</button>
                        <button type="button" class="mgmt-btn" id="ddns-clear">Clear saved settings</button>
                    </div>
                </form>`;
            this.#wire();
        } catch (e) {
            if (!silent) {
                this.innerHTML = `<p class="mgmt-p mgmt-note">Could not load DDNS settings: ${escapeHtml(e.message)}</p>`;
            }
        }
    }
}
