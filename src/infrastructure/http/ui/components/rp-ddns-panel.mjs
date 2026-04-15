import { apiFetch } from "../api-client.mjs";
import { ddnsSchedulerBlurb, escapeHtml, wrapCollapsibleTable } from "../formatters.mjs";

const DEFAULT_PORKBUN_API_BASE = "https://api.porkbun.com/api/json/v3";
const DEBOUNCE_MS = 450;

export class RpDdnsPanel extends HTMLElement {
    #onMgmtRefresh = () => this.render({ silent: false });

    /** @type {boolean} */
    #autosaveEnabled = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    #debounceTimer = null;
    /** @type {Promise<void>} */
    #saveChain = Promise.resolve();
    /** @type {ReturnType<typeof setTimeout> | null} */
    #savedFlashTimer = null;

    connectedCallback() {
        this.render({ silent: false });
        document.addEventListener("mgmt-refresh", this.#onMgmtRefresh);
    }

    disconnectedCallback() {
        document.removeEventListener("mgmt-refresh", this.#onMgmtRefresh);
        if (this.#debounceTimer != null) clearTimeout(this.#debounceTimer);
        if (this.#savedFlashTimer != null) clearTimeout(this.#savedFlashTimer);
    }

    #isAutosaveAllowed(data) {
        return data.configSource === "sqlite" && data.credentialsConfigured === true && data.configInvalid !== true;
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

    /** @param {object} data */
    #ddnsBadge(data) {
        if (data.configSource === "none") {
            return { badgeLabel: "Not configured", badgeClass: "mgmt-ddns-badge-neutral" };
        }
        if (data.configInvalid) {
            return { badgeLabel: "Config invalid", badgeClass: "mgmt-ddns-badge-warn" };
        }
        if (!data.enabled) {
            return { badgeLabel: "Paused", badgeClass: "mgmt-ddns-badge-paused" };
        }
        if (data.schedulerWouldRun) {
            return { badgeLabel: "Active", badgeClass: "mgmt-ddns-badge-active" };
        }
        return { badgeLabel: "Idle", badgeClass: "mgmt-ddns-badge-neutral" };
    }

    /**
     * Status strip: telemetry and actions (form below holds editable settings).
     * @param {object} data - DDNS summary from GET/PUT (includes cachedPublicIp, lastRun when present)
     */
    #buildStatusStripHtml(data) {
        const cached = data.cachedPublicIp;
        const cachedV4 = cached?.ipv4 ? escapeHtml(cached.ipv4) : "—";
        const cachedV6 = cached?.ipv6 ? escapeHtml(cached.ipv6) : "—";
        const { badgeLabel, badgeClass } = this.#ddnsBadge(data);
        const lr = data.lastRun;
        let lastLine = "—";
        if (lr && typeof lr.at === "string") {
            const t = escapeHtml(new Date(lr.at).toLocaleString());
            const oc = escapeHtml(lr.outcome);
            const det = escapeHtml(lr.detail || "");
            lastLine = `${t} · <strong>${oc}</strong> · ${det}`;
        }
        let nextLine = "—";
        if (data.enabled && data.configSource === "sqlite" && lr?.at && Number.isFinite(data.intervalMs)) {
            const next = new Date(new Date(lr.at).getTime() + data.intervalMs);
            nextLine = `${escapeHtml(next.toLocaleString())} (approx.)`;
        }
        const canSync =
            data.configSource === "sqlite" &&
            data.credentialsConfigured === true &&
            data.configInvalid !== true;
        const syncHidden = canSync ? "" : "hidden";

        return `<div class="mgmt-ddns-status-strip">
            <div class="mgmt-ddns-status-grid">
                <div class="mgmt-ddns-status-item"><span class="mgmt-ddns-status-k">Status</span>
                    <span class="mgmt-ddns-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span></div>
                <div class="mgmt-ddns-status-item"><span class="mgmt-ddns-status-k">Scheduler</span>
                    <span class="mgmt-ddns-status-v"><code>${escapeHtml(data.schedulerState || "")}</code> · scheduler ${
            data.schedulerWouldRun ? "would run" : "idle"
        }</span></div>
                <div class="mgmt-ddns-status-item"><span class="mgmt-ddns-status-k">Cached public IPv4</span> <span class="mgmt-ddns-status-v">${cachedV4}</span></div>
                <div class="mgmt-ddns-status-item"><span class="mgmt-ddns-status-k">Cached public IPv6</span> <span class="mgmt-ddns-status-v">${cachedV6}</span></div>
                <div class="mgmt-ddns-status-item mgmt-ddns-status-span2"><span class="mgmt-ddns-status-k">Last sync</span>
                    <span class="mgmt-ddns-status-v">${lastLine}</span></div>
                <div class="mgmt-ddns-status-item mgmt-ddns-status-span2"><span class="mgmt-ddns-status-k">Next tick (approx.)</span>
                    <span class="mgmt-ddns-status-v">${nextLine}</span></div>
            </div>
            <p class="mgmt-p mgmt-note mgmt-ddns-status-blurb">${escapeHtml(ddnsSchedulerBlurb(data))} Compare with <a href="index.html#network">Network</a> for live public IP and DNS.</p>
            <div class="mgmt-ddns-status-actions">
                <button type="button" class="mgmt-btn mgmt-btn-primary" id="ddns-sync-now" ${syncHidden}>Run sync now</button>
                <a class="mgmt-btn" href="index.html#network">Open Network</a>
            </div>
        </div>`;
    }

    /** @param {object} data */
    #patchSummaryFromData(data) {
        const root = this.querySelector("#ddns-summary-root");
        if (root) root.innerHTML = this.#buildStatusStripHtml(data);
    }

    #clearRowVisualStates() {
        for (const el of this.querySelectorAll("[data-ddns-field]")) {
            el.classList.remove("mgmt-ddns-row-pending", "mgmt-ddns-row-saved", "mgmt-ddns-row-error");
            el.removeAttribute("aria-busy");
        }
    }

    /** @param {string | null} field */
    #setRowPending(field) {
        this.#clearRowVisualStates();
        if (!field) return;
        const el = this.querySelector(`[data-ddns-field="${field}"]`);
        if (el) {
            el.classList.add("mgmt-ddns-row-pending");
            el.setAttribute("aria-busy", "true");
        }
    }

    /** @param {string | null} field */
    #flashRowSaved(field) {
        if (!field) return;
        const el = this.querySelector(`[data-ddns-field="${field}"]`);
        if (!el) return;
        el.classList.remove("mgmt-ddns-row-pending");
        el.removeAttribute("aria-busy");
        el.classList.add("mgmt-ddns-row-saved");
        if (this.#savedFlashTimer != null) clearTimeout(this.#savedFlashTimer);
        this.#savedFlashTimer = setTimeout(() => {
            el.classList.remove("mgmt-ddns-row-saved");
            this.#savedFlashTimer = null;
        }, 800);
    }

    /** @param {string | null} field */
    #setRowError(field) {
        this.#clearRowVisualStates();
        if (!field) return;
        const el = this.querySelector(`[data-ddns-field="${field}"]`);
        if (el) el.classList.add("mgmt-ddns-row-error");
    }

    /**
     * One PUT using current form DOM; updates summary and row visuals.
     * @param {string | null} field
     */
    async #doSinglePut(field) {
        const st = this.querySelector("#ddns-form-status");
        this.#setRowPending(field);
        if (st) st.textContent = "Saving…";
        try {
            const body = this.#buildPutBody();
            const sentKey = Boolean(body.porkbunApiKey);
            const sentSecret = Boolean(body.porkbunSecretKey);
            const res = await apiFetch("/api/v1/ddns", { method: "PUT", body: JSON.stringify(body) });
            this.#patchSummaryFromData(res.data);
            if (sentKey || sentSecret) {
                const ak = this.querySelector("#ddns-api-key");
                const sk = this.querySelector("#ddns-secret-key");
                if (ak) ak.value = "";
                if (sk) sk.value = "";
            }
            if (this.#isAutosaveAllowed(res.data)) {
                this.#autosaveEnabled = true;
                this.#updateBootstrapUiVisibility();
            }
            this.#flashRowSaved(field);
            if (st) st.textContent = "";
        } catch (err) {
            this.#setRowError(field);
            if (st) st.textContent = err.message;
            alert(err.message);
        }
    }

    /** @param {string | null} field */
    #enqueuePut(field) {
        this.#saveChain = this.#saveChain
            .catch(() => {})
            .then(() => this.#doSinglePut(field));
    }

    /**
     * @param {string | null} field - maps to [data-ddns-field]
     * @param {{ immediate?: boolean }} [opts]
     */
    #scheduleSave(field, opts = {}) {
        if (!this.#autosaveEnabled) return;
        if (this.#debounceTimer != null) clearTimeout(this.#debounceTimer);
        if (opts.immediate) {
            this.#debounceTimer = null;
            this.#enqueuePut(field);
            return;
        }
        this.#debounceTimer = setTimeout(() => {
            this.#debounceTimer = null;
            this.#enqueuePut(field);
        }, DEBOUNCE_MS);
    }

    #updateBootstrapUiVisibility() {
        const hint = this.querySelector("#ddns-enable-hint");
        const boot = this.querySelector("#ddns-bootstrap-save");
        const editNote = this.querySelector("#ddns-edit-note");
        if (this.#autosaveEnabled) {
            if (hint) {
                hint.innerHTML =
                    "Changes are saved automatically to SQLite. Use <strong>Clear saved settings</strong> below to remove configuration.";
            }
            if (boot) boot.hidden = true;
            if (editNote) {
                editNote.textContent =
                    "Updates persist as you edit (includes API secrets in the database). Omit key fields to keep stored keys. Remote clients need a signed-in session.";
            }
        } else {
            if (hint) {
                hint.innerHTML =
                    "Enter <strong>both</strong> Porkbun keys below, then choose <strong>Save initial settings</strong> once. After that, other fields update automatically.";
            }
            if (boot) boot.hidden = false;
            if (editNote) {
                editNote.textContent =
                    "First save stores credentials in SQLite. Remote clients need a signed-in session.";
            }
        }
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

        this.#updateBootstrapUiVisibility();

        this.querySelector("#ddns-enabled")?.addEventListener("change", () => {
            this.#scheduleSave("enabled", { immediate: true });
        });

        modeRadios.forEach(r =>
            r.addEventListener("change", () => {
                this.#scheduleSave("zones", { immediate: true });
            })
        );

        this.querySelector("#ddns-domains")?.addEventListener("input", () => this.#scheduleSave("domains"));
        this.querySelector("#ddns-match")?.addEventListener("input", () => this.#scheduleSave("match"));
        this.querySelector("#ddns-interval")?.addEventListener("input", () => this.#scheduleSave("interval"));
        this.querySelector("#ddns-ip-timeout")?.addEventListener("input", () => this.#scheduleSave("timeout"));

        const saveKeys = () => {
            if (!this.#autosaveEnabled) return;
            this.#scheduleSave("keys");
        };
        this.querySelector("#ddns-api-key")?.addEventListener("change", saveKeys);
        this.querySelector("#ddns-api-key")?.addEventListener("blur", saveKeys);
        this.querySelector("#ddns-secret-key")?.addEventListener("change", saveKeys);
        this.querySelector("#ddns-secret-key")?.addEventListener("blur", saveKeys);

        this.querySelector("#ddns-api-base")?.addEventListener("input", () => this.#scheduleSave("advanced"));
        this.querySelector("#ddns-ipv4-services")?.addEventListener("input", () => this.#scheduleSave("advanced"));
        this.querySelector("#ddns-ipv6-services")?.addEventListener("input", () => this.#scheduleSave("advanced"));

        form?.addEventListener("submit", async e => {
            e.preventDefault();
            if (this.#autosaveEnabled) return;
            const apiKey = this.querySelector("#ddns-api-key")?.value?.trim() ?? "";
            const secretKey = this.querySelector("#ddns-secret-key")?.value?.trim() ?? "";
            if (!apiKey || !secretKey) {
                if (st) st.textContent = "Enter both Porkbun API key and secret key for the first save.";
                alert("Enter both Porkbun API key and secret key for the first save.");
                return;
            }
            this.#saveChain = this.#saveChain.catch(() => {}).then(() => this.#doSinglePut("keys"));
            await this.#saveChain.catch(() => {});
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

        this.querySelector("#ddns-sync-now")?.addEventListener("click", async () => {
            const btn = this.querySelector("#ddns-sync-now");
            if (btn) btn.disabled = true;
            if (st) st.textContent = "Running sync…";
            try {
                await apiFetch("/api/v1/ddns/sync", { method: "POST" });
                if (st) st.textContent = "Sync completed.";
                document.dispatchEvent(new CustomEvent("mgmt-refresh"));
            } catch (e) {
                if (st) st.textContent = e.message;
                alert(e.message);
            } finally {
                if (btn) btn.disabled = false;
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
            this.#autosaveEnabled = this.#isAutosaveAllowed(data);

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

            const statusHtml = this.#buildStatusStripHtml(data);

            this.innerHTML = `
                <rp-panel-toolbar heading="DDNS (Porkbun)"></rp-panel-toolbar>
                <div id="ddns-summary-root">${statusHtml}</div>
                <h3 class="mgmt-h3">Edit settings</h3>
                <p class="mgmt-p mgmt-note" id="ddns-edit-note"></p>
                <form id="ddns-form" class="mgmt-ddns-form">
                    <div class="mgmt-form-row mgmt-form-row-check" data-ddns-field="enabled">
                        <label><input type="checkbox" id="ddns-enabled" ${data.enabled ? "checked" : ""}> Enable DDNS</label>
                    </div>
                    <p class="mgmt-note mgmt-ddns-enable-hint" id="ddns-enable-hint"></p>
                    <div data-ddns-field="keys">
                    <div class="mgmt-form-row">
                        <label for="ddns-api-key">Porkbun API key</label>
                        <input type="password" id="ddns-api-key" autocomplete="off" placeholder="unchanged if empty">
                    </div>
                    <div class="mgmt-form-row">
                        <label for="ddns-secret-key">Porkbun secret key</label>
                        <input type="password" id="ddns-secret-key" autocomplete="off" placeholder="unchanged if empty">
                    </div>
                    </div>
                    <fieldset class="mgmt-fieldset" data-ddns-field="zones">
                        <legend class="mgmt-legend">Zones</legend>
                        <label class="mgmt-radio-line"><input type="radio" name="ddns-domain-mode" value="apex" ${apexChecked}> Use configured apex domains (Domains panel / SQLite)</label>
                        <label class="mgmt-radio-line"><input type="radio" name="ddns-domain-mode" value="explicit" ${explicitChecked}> Explicit apex list</label>
                    </fieldset>
                    <div class="mgmt-form-row" id="ddns-domains-row" data-ddns-field="domains">
                        <label for="ddns-domains">Domains (one per line or comma-separated)</label>
                        <textarea id="ddns-domains" rows="3" class="mgmt-textarea" placeholder="example.com">${escapeHtml(
                domainsValue
            )}</textarea>
                    </div>
                    <div class="mgmt-form-row" data-ddns-field="match">
                        <label for="ddns-match">Match note</label>
                        <input type="text" id="ddns-match" value="${escapeHtml(data.matchNote || "")}" required maxlength="512">
                    </div>
                    <p class="mgmt-note mgmt-ddns-match-hint">Porkbun stores a <strong>notes</strong> string on each DNS record. This reverse proxy only updates <strong>A</strong> and <strong>AAAA</strong> records whose <strong>notes</strong> field is <em>exactly</em> this value; other records are never touched. Use a dedicated tag (for example the default <code>match:reverse-proxy-ddns</code>) so DDNS does not overwrite rows you manage elsewhere.</p>
                    <div class="mgmt-form-row" data-ddns-field="interval">
                        <label for="ddns-interval">Interval (ms)</label>
                        <input type="number" id="ddns-interval" min="10000" max="86400000" step="1000" value="${escapeHtml(
                String(data.intervalMs ?? 300000)
            )}" required>
                    </div>
                    <div class="mgmt-form-row" data-ddns-field="timeout">
                        <label for="ddns-ip-timeout">IP lookup timeout (ms)</label>
                        <input type="number" id="ddns-ip-timeout" min="1000" max="120000" step="500" value="${escapeHtml(
                String(data.ipLookupTimeoutMs ?? 8000)
            )}" required>
                    </div>
                    <div data-ddns-field="advanced">
                    ${wrapCollapsibleTable(`<div class="mgmt-ddns-advanced-inner">${advancedBlock}</div>`)}
                    </div>
                    <p class="mgmt-note" id="ddns-form-status" aria-live="polite"></p>
                    <div class="mgmt-form-actions">
                        <button type="submit" class="mgmt-btn mgmt-btn-primary" id="ddns-bootstrap-save">Save initial settings</button>
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
