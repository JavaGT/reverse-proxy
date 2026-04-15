/**
 * Server settings UI — GET/PUT /api/v1/settings
 */

/** @typedef {{ key: string, label: string, type: "text" | "number" | "checkbox" | "password", hint?: string }} FieldDef */

/** @type {FieldDef[]} */
const FIELDS = [
    { key: "tlsCertDir", label: "TLS certificate directory", type: "text", hint: "Let’s Encrypt live path or PEM directory" },
    { key: "rootDomains", label: "Root domains (comma-separated, bootstrap)", type: "text", hint: "Overridden by Domains in SQLite when saved there" },
    { key: "managementSubdomain", label: "Management subdomain", type: "text" },
    { key: "managementBaseDomain", label: "Management base domain (apex)", type: "text" },
    { key: "managementInterfacePort", label: "Management listener port (127.0.0.1)", type: "number" },
    { key: "healthCheckIntervalMs", label: "Health check interval (ms)", type: "number" },
    { key: "publicUrlHttpsPrefix", label: "Public URL HTTPS scheme prefix", type: "text" },
    { key: "publicUrlHttpPrefix", label: "Public URL HTTP scheme prefix", type: "text" },
    { key: "logRequests", label: "Log requests", type: "checkbox" },
    { key: "managementTrustProxy", label: "Trust reverse proxy (set to 1)", type: "text", hint: "1 or 0" },
    { key: "managementRateLimitMax", label: "Management rate limit (max requests / window)", type: "number" },
    { key: "managementRateLimitWindowMs", label: "Management rate limit window (ms)", type: "number" },
    { key: "managementDebugLocalOperator", label: "Debug local-operator detection", type: "checkbox" },
    { key: "managementLocalOperatorIps", label: "Extra local-operator IPs (comma-separated)", type: "text" },
    { key: "managementAutoPublicEgressIp", label: "Auto public egress IP for XFF match", type: "checkbox" },
    { key: "managementRegistrationSecret", label: "Registration invite secret (optional)", type: "password", hint: "Leave blank to keep unchanged; use Accounts page to copy" },
    { key: "managementSessionSecret", label: "Session signing secret", type: "password", hint: "Leave blank to keep unchanged" },
    { key: "managementAuthRpId", label: "WebAuthn rpID (fallback)", type: "text" },
    { key: "managementAuthOrigin", label: "WebAuthn origin (fallback)", type: "text" },
    { key: "managementAuthCookieSecure", label: "Secure session cookies (1 or 0)", type: "text" },
    { key: "managementAuthDataDir", label: "Management auth data directory", type: "text" },
    { key: "dnsLookupTimeoutMs", label: "DNS lookup timeout (ms)", type: "number" },
    {
        key: "dnsConsoleDefaultProvider",
        label: "DNS console default provider",
        type: "text",
        hint: "e.g. porkbun. Used when Domains → DNS console has no default (per-apex overrides win first; see Domains page)."
    },
    { key: "ipLookupTimeoutMs", label: "Public IP lookup timeout (ms)", type: "number" },
    { key: "publicIngressProbeHttpsPort", label: "Public ingress HTTPS probe port", type: "number" },
    { key: "publicIngressProbeTimeoutMs", label: "Public ingress probe timeout (ms)", type: "number" }
];

const root = document.getElementById("settings-fields");
const msg = document.getElementById("settings-msg");
const bootstrap = document.getElementById("settings-bootstrap");
const saveBtn = document.getElementById("settings-save");

let lastSecrets = { registrationSecret: false, sessionSecret: false };

function fieldId(k) {
    return `s-${k}`;
}

function renderForm() {
    if (!root) return;
    root.replaceChildren();
    for (const f of FIELDS) {
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
            input.type = f.type === "password" ? "password" : f.type === "number" ? "number" : "text";
            input.id = fieldId(f.key);
            if (f.type === "number") input.step = "1";
            input.autocomplete = f.type === "password" ? "new-password" : "off";
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
        root.appendChild(wrap);
    }
}

function setMsg(t) {
    if (msg) msg.textContent = t ?? "";
}

function fill(settings, secretsCfg) {
    lastSecrets = secretsCfg || lastSecrets;
    for (const f of FIELDS) {
        const el = document.getElementById(fieldId(f.key));
        if (!el) continue;
        const v = settings[f.key];
        if (f.type === "checkbox") {
            el.checked = v === true || v === "true" || v === 1;
        } else if (f.type === "password") {
            el.value = "";
            el.placeholder =
                f.key === "managementRegistrationSecret"
                    ? lastSecrets.registrationSecret
                        ? "(configured — type to replace)"
                        : "(not set)"
                    : lastSecrets.sessionSecret
                      ? "(configured — type to replace)"
                      : "(not set)";
        } else if (v === null || v === undefined) {
            el.value = "";
        } else {
            el.value = String(v);
        }
    }
}

function collect() {
    /** @type {Record<string, unknown>} */
    const body = {};
    for (const f of FIELDS) {
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
}

async function load() {
    setMsg("");
    try {
        const res = await fetch("/api/v1/settings", { credentials: "include", headers: { Accept: "application/json" } });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error?.message || j?.message || res.statusText);
        const data = j.data;
        if (bootstrap && Array.isArray(data?.bootstrapEnvKeys)) {
            bootstrap.textContent = `Always configured via .env (not in SQLite): ${data.bootstrapEnvKeys.join(", ")}.`;
        }
        fill(data.settings || {}, data.secretsConfigured || {});
    } catch (e) {
        setMsg(e?.message || String(e));
    }
}

saveBtn?.addEventListener("click", async () => {
    setMsg("");
    saveBtn.disabled = true;
    try {
        const body = collect();
        const res = await fetch("/api/v1/settings", {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(body)
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error?.message || j?.message || res.statusText);
        const d = j.data;
        fill(d.settings || {}, d.secretsConfigured || {});
        setMsg(d.notice || "Saved.");
    } catch (e) {
        setMsg(e?.message || String(e));
    } finally {
        saveBtn.disabled = false;
    }
});

document.addEventListener("mgmt-refresh", () => load());

renderForm();
load();
