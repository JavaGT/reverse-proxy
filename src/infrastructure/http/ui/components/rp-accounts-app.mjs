/**
 * Accounts page: invite secret, 2FA, passkeys, user list.
 */

import { AuthClient } from "/management-auth-sdk.js";
import { apiFetch, apiFetchResult, messageFromErrorBody } from "../api-client.mjs";

const ACCOUNTS_MARKUP = `
<header class="mgmt-masthead">
    <h1>Accounts</h1>
    <p class="mgmt-sub">Registration invite secret and express-easy-auth users for this management server.</p>
</header>
<section class="mgmt-section" aria-labelledby="invite-heading">
    <h2 id="invite-heading">Registration invite</h2>
    <p class="mgmt-p">
        People creating an account at <a href="/register.html">/register.html</a> need this secret in the registration form. It matches <code>MANAGEMENT_REGISTRATION_SECRET</code> in the server environment.
    </p>
    <p id="invite-unconfigured" class="mgmt-p mgmt-note" hidden>
        Registration invite is not configured. Set <code>MANAGEMENT_REGISTRATION_SECRET</code> in the environment and restart the server to enable new sign-ups.
    </p>
    <div id="invite-configured" class="mgmt-account-invite-block" hidden>
        <label class="mgmt-label" for="mgmt-invite-secret-field">Invite secret</label>
        <div class="mgmt-account-invite-controls">
            <input type="password" readonly id="mgmt-invite-secret-field" class="mgmt-invite-input" autocomplete="off" spellcheck="false" aria-label="Registration invite secret" />
            <button type="button" class="mgmt-btn" id="mgmt-copy-invite-secret">Copy</button>
        </div>
    </div>
</section>
<section class="mgmt-section" aria-labelledby="security-heading">
    <h2 id="security-heading">Your sign-in security</h2>
    <p id="security-unsigned" class="mgmt-p mgmt-note" hidden>
        <a href="/login.html?return=%2Faccounts.html">Sign in</a> to register passkeys and manage two-factor authentication for your account. Same-machine access without a session cannot change these settings.
    </p>
    <div id="security-signed" hidden>
        <div class="mgmt-security-block">
            <h3 class="mgmt-h3">Two-factor authentication (TOTP)</h3>
            <p id="twofa-summary" class="mgmt-p"></p>
            <div class="mgmt-login-actions">
                <button type="button" class="mgmt-btn mgmt-btn-primary" id="twofa-setup-start">Set up 2FA</button>
                <button type="button" class="mgmt-btn" id="twofa-disable" hidden>Turn off 2FA</button>
            </div>
            <div id="twofa-setup-wizard" class="mgmt-security-wizard" hidden>
                <p class="mgmt-p mgmt-note">Scan the QR code in an authenticator app (Google Authenticator, 1Password, etc.), or enter the secret manually.</p>
                <div id="twofa-qr-wrap" class="mgmt-twofa-qr-wrap" hidden>
                    <img id="twofa-qr-img" width="180" height="180" alt="2FA QR code" />
                </div>
                <p id="twofa-secret-line" class="mgmt-p mgmt-mono" hidden></p>
                <div class="mgmt-login-field">
                    <label class="mgmt-label" for="twofa-verify-code">6-digit code</label>
                    <input id="twofa-verify-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="000000" />
                </div>
                <div class="mgmt-login-actions">
                    <button type="button" class="mgmt-btn mgmt-btn-primary" id="twofa-verify-submit">Enable 2FA</button>
                    <button type="button" class="mgmt-btn" id="twofa-setup-cancel">Cancel</button>
                </div>
            </div>
            <div id="twofa-recovery" class="mgmt-twofa-recovery" hidden>
                <p class="mgmt-p"><strong>Recovery codes</strong> — save these in a safe place; they will not be shown again.</p>
                <ul id="twofa-recovery-list" class="mgmt-recovery-codes"></ul>
            </div>
            <div id="twofa-reauth" class="mgmt-security-reauth" hidden>
                <p class="mgmt-p mgmt-note">Recent sign-in required. Enter your password to continue (and 2FA code if prompted).</p>
                <div class="mgmt-login-field">
                    <label class="mgmt-label" for="twofa-reauth-pass">Password</label>
                    <input id="twofa-reauth-pass" type="password" autocomplete="current-password" />
                </div>
                <div class="mgmt-login-field">
                    <label class="mgmt-label" for="twofa-reauth-totp">2FA code</label>
                    <input id="twofa-reauth-totp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="If required" />
                </div>
                <div class="mgmt-login-actions">
                    <button type="button" class="mgmt-btn mgmt-btn-primary" id="twofa-reauth-submit">Confirm and turn off 2FA</button>
                </div>
            </div>
            <p id="twofa-msg" class="mgmt-login-msg" role="status"></p>
        </div>
        <div class="mgmt-security-block">
            <h3 class="mgmt-h3">Passkeys</h3>
            <p class="mgmt-p mgmt-note">Passkeys are tied to this browser/device and your management hostname. Add one for passwordless sign-in.</p>
            <ul id="passkeys-list" class="mgmt-passkeys-list" aria-label="Registered passkeys"></ul>
            <div class="mgmt-login-actions">
                <button type="button" class="mgmt-btn mgmt-btn-primary" id="passkey-add">Register a passkey</button>
            </div>
            <p id="passkeys-msg" class="mgmt-login-msg" role="status"></p>
        </div>
    </div>
</section>
<section class="mgmt-section" aria-labelledby="accounts-heading">
    <h2 id="accounts-heading">Users</h2>
    <p class="mgmt-p mgmt-note">Delete accounts you no longer need. You cannot remove the account you are signed in as, or the only remaining user.</p>
    <div class="mgmt-table-wrap">
        <table class="mgmt-table" id="accounts-table">
            <thead>
                <tr>
                    <th scope="col">Username</th>
                    <th scope="col">Email</th>
                    <th scope="col">2FA</th>
                    <th scope="col">Passkeys</th>
                    <th scope="col">Created</th>
                    <th scope="col">Actions</th>
                </tr>
            </thead>
            <tbody id="accounts-tbody"></tbody>
        </table>
    </div>
    <p id="accounts-msg" class="mgmt-login-msg" role="alert"></p>
</section>`;

export class RpAccountsApp extends HTMLElement {
    #client = new AuthClient({ baseUrl: "/api", apiVersion: "v1" });

    connectedCallback() {
        if (this.dataset.wired) return;
        this.dataset.wired = "1";
        this.innerHTML = ACCOUNTS_MARKUP;
        const root = this;
        const $ = sel => root.querySelector(sel);

        const tbody = $("#accounts-tbody");
        const msg = $("#accounts-msg");
        const inviteUnconfigured = $("#invite-unconfigured");
        const inviteConfigured = $("#invite-configured");
        const inviteField = $("#mgmt-invite-secret-field");
        const copyBtn = $("#mgmt-copy-invite-secret");
        const securityUnsigned = $("#security-unsigned");
        const securitySigned = $("#security-signed");
        const twofaSummary = $("#twofa-summary");
        const twofaSetupWizard = $("#twofa-setup-wizard");
        const twofaQrWrap = $("#twofa-qr-wrap");
        const twofaQrImg = $("#twofa-qr-img");
        const twofaSecretLine = $("#twofa-secret-line");
        const twofaVerifyCode = $("#twofa-verify-code");
        const twofaSetupStart = $("#twofa-setup-start");
        const twofaSetupCancel = $("#twofa-setup-cancel");
        const twofaVerifySubmit = $("#twofa-verify-submit");
        const twofaDisable = $("#twofa-disable");
        const twofaRecovery = $("#twofa-recovery");
        const twofaRecoveryList = $("#twofa-recovery-list");
        const twofaReauth = $("#twofa-reauth");
        const twofaReauthPass = $("#twofa-reauth-pass");
        const twofaReauthTotp = $("#twofa-reauth-totp");
        const twofaReauthSubmit = $("#twofa-reauth-submit");
        const twofaMsg = $("#twofa-msg");
        const passkeysList = $("#passkeys-list");
        const passkeyAdd = $("#passkey-add");
        const passkeysMsg = $("#passkeys-msg");

        const showMsg = t => {
            if (msg) msg.textContent = t ?? "";
        };
        const showTwofaMsg = t => {
            if (twofaMsg) twofaMsg.textContent = t ?? "";
        };
        const showPasskeysMsg = t => {
            if (passkeysMsg) passkeysMsg.textContent = t ?? "";
        };

        const loadCurrentUserId = async () => {
            try {
                const { res, body: j } = await apiFetchResult("/api/v1/auth/status");
                if (res.ok && j?.authenticated && j?.user?.id) return j.user.id;
            } catch {
                /* ignore */
            }
            return null;
        };

        const loadInviteSecret = async () => {
            if (!inviteField || !inviteUnconfigured || !inviteConfigured) return;
            try {
                const j = await apiFetch("/api/v1/registration-secret");
                const configured =
                    j?.data?.configured === true &&
                    typeof j?.data?.secret === "string" &&
                    j.data.secret.length > 0;
                if (configured) {
                    inviteField.value = j.data.secret;
                    inviteConfigured.hidden = false;
                    inviteUnconfigured.hidden = true;
                } else {
                    inviteField.value = "";
                    inviteConfigured.hidden = true;
                    inviteUnconfigured.hidden = false;
                }
            } catch {
                inviteField.value = "";
                inviteConfigured.hidden = true;
                inviteUnconfigured.hidden = false;
            }
        };

        const formatTime = ms => {
            if (ms == null || typeof ms !== "number") return "—";
            try {
                return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
            } catch {
                return "—";
            }
        };

        const resetTwofaWizard = () => {
            if (twofaSetupWizard) twofaSetupWizard.hidden = true;
            if (twofaQrWrap) twofaQrWrap.hidden = true;
            if (twofaQrImg) twofaQrImg.removeAttribute("src");
            if (twofaSecretLine) {
                twofaSecretLine.textContent = "";
                twofaSecretLine.hidden = true;
            }
            if (twofaVerifyCode) twofaVerifyCode.value = "";
            showTwofaMsg("");
        };

        const postFreshAuth = async (password, totpCode) => {
            const body = { password };
            const t = totpCode != null ? String(totpCode).trim() : "";
            if (t) {
                body.totpCode = t;
                body.token = t;
            }
            const { res, body: j } = await apiFetchResult("/api/v1/auth/fresh-auth", {
                method: "POST",
                body: JSON.stringify(body)
            });
            if (res.ok && j && typeof j === "object" && j.requires2FA) {
                return { needsTotp: true };
            }
            if (!res.ok) {
                throw new Error(messageFromErrorBody(j, res.status));
            }
            return { ok: true };
        };

        const tryDisable2FA = async () => {
            const { res, body: j } = await apiFetchResult("/api/v1/auth/2fa/disable", {
                method: "POST",
                body: JSON.stringify({})
            });
            if (res.ok) return { ok: true };
            const code =
                j && typeof j === "object" && j.error && typeof j.error === "object"
                    ? j.error.code
                    : undefined;
            if (res.status === 403 && code === "FRESH_AUTH_REQUIRED") {
                return { needsFreshAuth: true };
            }
            throw new Error(messageFromErrorBody(j, res.status));
        };

        const loadPasskeysList = async () => {
            if (!passkeysList) return;
            passkeysList.replaceChildren();
            showPasskeysMsg("");
            try {
                const data = await this.#client.listPasskeys();
                const keys = Array.isArray(data?.passkeys) ? data.passkeys : [];
                if (keys.length === 0) {
                    const li = document.createElement("li");
                    li.className = "mgmt-passkeys-empty";
                    li.textContent = "No passkeys yet.";
                    passkeysList.appendChild(li);
                    return;
                }
                for (const pk of keys) {
                    const li = document.createElement("li");
                    const left = document.createElement("span");
                    left.className = "mgmt-passkeys-meta";
                    const name = document.createElement("strong");
                    name.textContent = pk.name || pk.friendly_name || "Passkey";
                    const meta = document.createElement("span");
                    meta.className = "mgmt-passkeys-sub";
                    const parts = [];
                    if (pk.device_type) parts.push(pk.device_type);
                    parts.push(`added ${formatTime(pk.created_at)}`);
                    meta.textContent = parts.join(" · ");
                    left.appendChild(name);
                    left.appendChild(document.createTextNode(" "));
                    left.appendChild(meta);
                    const del = document.createElement("button");
                    del.type = "button";
                    del.className = "mgmt-btn";
                    del.textContent = "Remove";
                    del.title = "Remove this passkey";
                    del.addEventListener("click", async () => {
                        if (!window.confirm("Remove this passkey from your account?")) return;
                        del.disabled = true;
                        showPasskeysMsg("");
                        try {
                            await this.#client.deletePasskey(pk.id);
                            await loadPasskeysList();
                            await loadAccountsTable();
                        } catch (e) {
                            showPasskeysMsg(e?.message || String(e));
                        } finally {
                            del.disabled = false;
                        }
                    });
                    li.appendChild(left);
                    li.appendChild(del);
                    passkeysList.appendChild(li);
                }
            } catch (e) {
                showPasskeysMsg(e?.message || String(e));
            }
        };

        const loadSecurityPanel = async () => {
            if (!securityUnsigned || !securitySigned) return;
            let status;
            try {
                status = await this.#client.getStatus();
            } catch {
                securityUnsigned.hidden = false;
                securitySigned.hidden = true;
                return;
            }
            if (!status?.authenticated) {
                securityUnsigned.hidden = false;
                securitySigned.hidden = true;
                return;
            }
            securityUnsigned.hidden = true;
            securitySigned.hidden = false;
            const has2FA = status.security?.has2FA === true;
            if (twofaSummary) {
                twofaSummary.textContent = has2FA
                    ? "Two-factor authentication is enabled. Sign-in requires your authenticator app or a recovery code at login."
                    : "Two-factor authentication is off. Use Set up to add TOTP.";
            }
            if (twofaSetupStart) twofaSetupStart.hidden = has2FA;
            if (twofaDisable) twofaDisable.hidden = !has2FA;
            if (!has2FA) resetTwofaWizard();
            if (twofaRecovery) twofaRecovery.hidden = true;
            if (twofaReauth) {
                twofaReauth.hidden = true;
                if (twofaReauthPass) twofaReauthPass.value = "";
                if (twofaReauthTotp) twofaReauthTotp.value = "";
            }
            if (passkeyAdd) {
                passkeyAdd.disabled = typeof window.PublicKeyCredential === "undefined";
                passkeyAdd.title = passkeyAdd.disabled
                    ? "WebAuthn not available in this browser"
                    : "";
            }
            await loadPasskeysList();
        };

        const loadAccountsTable = async () => {
            if (!tbody) return;
            showMsg("");
            const selfId = await loadCurrentUserId();
            try {
                const j = await apiFetch("/api/v1/accounts");
                const accounts = Array.isArray(j?.data?.accounts) ? j.data.accounts : [];
                tbody.replaceChildren();
                for (const a of accounts) {
                    const tr = document.createElement("tr");
                    const you = selfId && a.id === selfId;
                    const uname = document.createElement("td");
                    uname.textContent = a.username ?? "";
                    if (you) {
                        const badge = document.createElement("span");
                        badge.className = "mgmt-badge";
                        badge.textContent = "you";
                        uname.appendChild(document.createTextNode(" "));
                        uname.appendChild(badge);
                    }
                    const email = document.createElement("td");
                    email.textContent = a.email ?? "";
                    const twofa = document.createElement("td");
                    twofa.textContent = a.totpEnabled ? "On" : "Off";
                    const pk = document.createElement("td");
                    pk.textContent = String(a.passkeyCount ?? 0);
                    const created = document.createElement("td");
                    created.textContent = formatTime(a.createdAt);
                    const actions = document.createElement("td");
                    const del = document.createElement("button");
                    del.type = "button";
                    del.className = "mgmt-btn";
                    del.textContent = "Delete";
                    del.disabled = you || accounts.length <= 1;
                    del.title = you
                        ? "Cannot delete your own account while signed in"
                        : accounts.length <= 1
                          ? "Cannot delete the only remaining account"
                          : `Remove ${a.username ?? "user"}`;
                    del.addEventListener("click", async () => {
                        if (!window.confirm(`Remove account "${a.username}"? This cannot be undone.`)) return;
                        showMsg("");
                        del.disabled = true;
                        try {
                            await apiFetch(`/api/v1/accounts/${encodeURIComponent(a.id)}`, { method: "DELETE" });
                            await loadAccountsTable();
                            await loadSecurityPanel();
                        } catch (e) {
                            showMsg(e?.message || String(e));
                            del.disabled = false;
                        }
                    });
                    actions.appendChild(del);
                    tr.append(uname, email, twofa, pk, created, actions);
                    tbody.appendChild(tr);
                }
                if (accounts.length === 0) {
                    const tr = document.createElement("tr");
                    const td = document.createElement("td");
                    td.colSpan = 6;
                    td.className = "mgmt-table-empty";
                    td.textContent =
                        "No users yet. Register at /register.html when the invite secret is configured.";
                    tr.appendChild(td);
                    tbody.appendChild(tr);
                }
            } catch (e) {
                showMsg(e?.message || String(e));
                tbody.replaceChildren();
            }
        };

        const loadAll = async () => {
            await loadInviteSecret();
            await loadSecurityPanel();
            await loadAccountsTable();
        };

        copyBtn?.addEventListener("click", async () => {
            if (!inviteField?.value) return;
            try {
                await navigator.clipboard.writeText(inviteField.value);
                const prev = copyBtn.textContent;
                copyBtn.textContent = "Copied";
                setTimeout(() => {
                    copyBtn.textContent = prev;
                }, 1500);
            } catch {
                inviteField.select();
            }
        });

        twofaSetupStart?.addEventListener("click", async () => {
            showTwofaMsg("");
            if (twofaRecovery) twofaRecovery.hidden = true;
            try {
                const data = await this.#client.setup2FA();
                if (twofaSetupWizard) twofaSetupWizard.hidden = false;
                if (twofaQrImg && data.qrCode) {
                    twofaQrImg.src = data.qrCode;
                    if (twofaQrWrap) twofaQrWrap.hidden = false;
                } else if (twofaQrWrap) {
                    twofaQrWrap.hidden = true;
                }
                if (twofaSecretLine && data.secret) {
                    twofaSecretLine.textContent = `Secret: ${data.secret}`;
                    twofaSecretLine.hidden = false;
                }
                if (twofaVerifyCode) twofaVerifyCode.focus();
            } catch (e) {
                showTwofaMsg(e?.message || String(e));
            }
        });

        twofaSetupCancel?.addEventListener("click", async () => {
            resetTwofaWizard();
            await loadSecurityPanel();
        });

        twofaVerifySubmit?.addEventListener("click", async () => {
            const code = twofaVerifyCode?.value?.trim() ?? "";
            if (!code) {
                showTwofaMsg("Enter the 6-digit code from your authenticator.");
                return;
            }
            showTwofaMsg("");
            try {
                const out = await this.#client.verify2FASetup(code);
                resetTwofaWizard();
                if (twofaSetupStart) twofaSetupStart.hidden = true;
                if (twofaDisable) twofaDisable.hidden = false;
                if (twofaSummary) {
                    twofaSummary.textContent =
                        "Two-factor authentication is enabled. Sign-in requires your authenticator app or a recovery code at login.";
                }
                if (
                    twofaRecovery &&
                    twofaRecoveryList &&
                    Array.isArray(out.recoveryCodes) &&
                    out.recoveryCodes.length > 0
                ) {
                    twofaRecovery.hidden = false;
                    twofaRecoveryList.replaceChildren();
                    for (const c of out.recoveryCodes) {
                        const li = document.createElement("li");
                        li.textContent = c;
                        twofaRecoveryList.appendChild(li);
                    }
                }
                await loadAccountsTable();
            } catch (e) {
                showTwofaMsg(e?.message || String(e));
            }
        });

        twofaDisable?.addEventListener("click", async () => {
            showTwofaMsg("");
            if (twofaReauth) twofaReauth.hidden = true;
            try {
                const r = await tryDisable2FA();
                if (r.needsFreshAuth) {
                    if (twofaReauth) twofaReauth.hidden = false;
                    if (twofaReauthPass) twofaReauthPass.focus();
                    showTwofaMsg(
                        "Enter your password to confirm (session must be recent, or confirm below)."
                    );
                    return;
                }
                await loadSecurityPanel();
                await loadAccountsTable();
            } catch (e) {
                showTwofaMsg(e?.message || String(e));
            }
        });

        twofaReauthSubmit?.addEventListener("click", async () => {
            const pass = twofaReauthPass?.value ?? "";
            const totp = twofaReauthTotp?.value?.trim() ?? "";
            showTwofaMsg("");
            if (!pass) {
                showTwofaMsg("Password is required.");
                return;
            }
            twofaReauthSubmit.disabled = true;
            try {
                const r = await postFreshAuth(pass, totp);
                if (r.needsTotp && !totp) {
                    showTwofaMsg("Enter your current 2FA code.");
                    twofaReauthSubmit.disabled = false;
                    twofaReauthTotp?.focus();
                    return;
                }
                const d2 = await tryDisable2FA();
                if (d2.needsFreshAuth) {
                    showTwofaMsg("Session still not fresh; try signing in again.");
                    twofaReauthSubmit.disabled = false;
                    return;
                }
                if (twofaReauth) twofaReauth.hidden = true;
                if (twofaReauthPass) twofaReauthPass.value = "";
                if (twofaReauthTotp) twofaReauthTotp.value = "";
                await loadSecurityPanel();
                await loadAccountsTable();
            } catch (e) {
                showTwofaMsg(e?.message || String(e));
            } finally {
                twofaReauthSubmit.disabled = false;
            }
        });

        passkeyAdd?.addEventListener("click", async () => {
            const label = window.prompt("Name for this passkey (e.g. MacBook, YubiKey)", "Passkey");
            if (label === null) return;
            showPasskeysMsg("");
            passkeyAdd.disabled = true;
            try {
                await this.#client.registerPasskey(label.trim() || "Passkey");
                await loadPasskeysList();
                await loadAccountsTable();
            } catch (e) {
                showPasskeysMsg(e?.message || String(e));
            } finally {
                passkeyAdd.disabled = typeof window.PublicKeyCredential === "undefined";
            }
        });

        document.addEventListener("mgmt-refresh", loadAll);
        loadAll();
    }
}
