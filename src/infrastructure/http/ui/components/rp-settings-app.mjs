/**
 * Server settings UI — GET/PUT /api/v1/settings
 * Field labels, hints, and groups come from `data.ui` (see `serverSettingsUi.mjs`).
 */

import { apiFetch } from "../api-client.mjs";

/** @typedef {{ key: string, label: string, type: "text" | "number" | "checkbox" | "password", hint?: string }} FieldDef */

function fieldId(k) {
    return `s-${k}`;
}

export class RpSettingsApp extends HTMLElement {
    #lastSecrets = { registrationSecret: false, sessionSecret: false };

    connectedCallback() {
        if (this.dataset.wired) return;
        this.dataset.wired = "1";

        /** @type {FieldDef[]} */
        let manifestFields = [];
        /** @type {{ summary: string, open: boolean, keys: string[] }[]} */
        let manifestGroups = [];

        this.innerHTML = `
<header class="mgmt-masthead">
    <h1>Server settings</h1>
    <p class="mgmt-sub">Tune listener ports, TLS, auth, and probes. Values are stored in SQLite and applied on save; some changes need a process restart. Save from localhost or a signed-in session.</p>
</header>
<section class="mgmt-section">
    <p id="settings-bootstrap" class="mgmt-p mgmt-note"></p>
    <div id="settings-fields" class="mgmt-settings-fields" aria-live="polite"><p class="mgmt-p mgmt-note" id="settings-loading">Loading…</p></div>
    <div class="mgmt-login-actions">
        <button type="button" class="mgmt-btn mgmt-btn-primary" id="settings-save">Save settings</button>
    </div>
    <p id="settings-msg" class="mgmt-login-msg" role="status" aria-live="polite"></p>
</section>`;

        const root = this;
        const $ = sel => root.querySelector(sel);
        const fieldsEl = $("#settings-fields");
        const msgEl = $("#settings-msg");
        const bootstrap = $("#settings-bootstrap");
        const saveBtn = $("#settings-save");

        const fieldByKey = () => Object.fromEntries(manifestFields.map(f => [f.key, f]));

        const renderForm = () => {
            if (!fieldsEl) return;
            fieldsEl.replaceChildren();
            if (manifestFields.length === 0) {
                const p = document.createElement("p");
                p.className = "mgmt-p mgmt-note";
                p.id = "settings-loading";
                p.textContent = "Loading…";
                fieldsEl.appendChild(p);
                return;
            }
            const fb = fieldByKey();
            for (const g of manifestGroups) {
                const det = document.createElement("details");
                det.className = "mgmt-details mgmt-settings-group";
                if (g.open) det.open = true;
                const sum = document.createElement("summary");
                sum.textContent = g.summary;
                det.appendChild(sum);
                const body = document.createElement("div");
                body.className = "mgmt-details-body";
                for (const key of g.keys) {
                    const f = fb[key];
                    if (!f) continue;
                    const wrap = document.createElement("div");
                    wrap.className = "mgmt-login-field";
                    const lab = document.createElement("label");
                    lab.className = "mgmt-label";
                    lab.htmlFor = fieldId(f.key);
                    lab.textContent = f.label;
                    let input;
                    if (f.type === "checkbox") {
                        input = document.createElement("input");
                        input.type = "checkbox";
                        input.id = fieldId(f.key);
                    } else {
                        input = document.createElement("input");
                        input.type =
                            f.type === "password" ? "password" : f.type === "number" ? "number" : "text";
                        input.id = fieldId(f.key);
                        if (f.type === "number") input.step = "1";
                        input.autocomplete = f.type === "password" ? "new-password" : "off";
                        input.spellcheck = false;
                    }
                    wrap.appendChild(lab);
                    wrap.appendChild(input);
                    if (f.hint) {
                        const p = document.createElement("p");
                        p.className = "mgmt-p mgmt-note";
                        p.style.marginTop = "0.15rem";
                        p.textContent = f.hint;
                        wrap.appendChild(p);
                    }
                    body.appendChild(wrap);
                }
                det.appendChild(body);
                fieldsEl.appendChild(det);
            }
        };

        const setMsg = t => {
            if (msgEl) msgEl.textContent = t ?? "";
        };

        const fill = (settings, secretsCfg) => {
            this.#lastSecrets = secretsCfg || this.#lastSecrets;
            for (const f of manifestFields) {
                const el = document.getElementById(fieldId(f.key));
                if (!el) continue;
                const v = settings[f.key];
                if (f.type === "checkbox") {
                    el.checked = v === true || v === "true" || v === 1;
                } else if (f.type === "password") {
                    el.value = "";
                    el.placeholder =
                        f.key === "managementRegistrationSecret"
                            ? this.#lastSecrets.registrationSecret
                                ? "(configured — type to replace…)"
                                : "(not set)"
                            : this.#lastSecrets.sessionSecret
                              ? "(configured — type to replace…)"
                              : "(not set)";
                } else if (v === null || v === undefined) {
                    el.value = "";
                } else {
                    el.value = String(v);
                }
            }
        };

        const collect = () => {
            /** @type {Record<string, unknown>} */
            const body = {};
            for (const f of manifestFields) {
                const el = document.getElementById(fieldId(f.key));
                if (!el) continue;
                if (f.type === "checkbox") {
                    body[f.key] = el.checked;
                    continue;
                }
                if (f.type === "password") {
                    const t = el.value.trim();
                    if (t) body[f.key] = t;
                    continue;
                }
                const t = el.value.trim();
                if (f.type === "number") {
                    if (t === "") continue;
                    const n = parseInt(t, 10);
                    if (Number.isFinite(n)) body[f.key] = n;
                    continue;
                }
                body[f.key] = t;
            }
            return body;
        };

        const load = async () => {
            setMsg("");
            try {
                const j = await apiFetch("/api/v1/settings");
                const data = j.data;
                if (bootstrap && Array.isArray(data?.bootstrapEnvKeys) && data.bootstrapEnvKeys.length > 0) {
                    bootstrap.textContent = `Also configured outside SQLite: ${data.bootstrapEnvKeys.join(", ")}.`;
                } else if (bootstrap) {
                    bootstrap.textContent = "";
                }
                const ui = data?.ui;
                if (!ui?.fields || !Array.isArray(ui.fields) || !ui?.groups || !Array.isArray(ui.groups)) {
                    manifestFields = [];
                    manifestGroups = [];
                    renderForm();
                    setMsg("Settings UI manifest missing from the server. Update reverse-proxy.");
                    return;
                }
                manifestFields = ui.fields;
                manifestGroups = ui.groups;
                renderForm();
                fill(data.settings || {}, data.secretsConfigured || {});
            } catch (e) {
                setMsg(e?.message || String(e));
            }
        };

        saveBtn?.addEventListener("click", async () => {
            setMsg("");
            saveBtn.disabled = true;
            try {
                const body = collect();
                const j = await apiFetch("/api/v1/settings", {
                    method: "PUT",
                    body: JSON.stringify(body)
                });
                const d = j.data;
                if (d?.ui?.fields && Array.isArray(d.ui.fields) && d?.ui?.groups) {
                    manifestFields = d.ui.fields;
                    manifestGroups = d.ui.groups;
                    renderForm();
                }
                fill(d.settings || {}, d.secretsConfigured || {});
                setMsg(d.notice || "Saved.");
            } catch (e) {
                setMsg(e?.message || String(e));
            } finally {
                saveBtn.disabled = false;
            }
        });

        document.addEventListener("mgmt-refresh", load);

        load();
    }
}
