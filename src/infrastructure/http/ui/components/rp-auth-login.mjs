/**
 * Sign-in page: password / 2FA / passkey flows (express-easy-auth SDK).
 */

import { AuthClient } from "/management-auth-sdk.js";

function safeReturn(raw) {
    if (raw == null || typeof raw !== "string") return "/";
    const t = raw.trim();
    if (!t.startsWith("/") || t.startsWith("//")) return "/";
    return t;
}

function needs2faResponse(err) {
    return err?.code === "2FA_REQUIRED" || err?.data?.requires2FA === true;
}

export class RpAuthLogin extends HTMLElement {
    connectedCallback() {
        if (this.dataset.wired) return;
        this.dataset.wired = "1";

        this.innerHTML = `
<div class="mgmt-login-wrap">
    <header class="mgmt-masthead">
        <h1>Sign in</h1>
        <p class="mgmt-sub">Username, password, optional 2FA, or a passkey on this device.</p>
    </header>
    <section class="mgmt-section">
        <form id="form-pass" autocomplete="on">
            <div class="mgmt-login-field">
                <label class="mgmt-label" for="user">Username</label>
                <input id="user" name="username" type="text" autocomplete="username" required>
            </div>
            <div class="mgmt-login-field">
                <label class="mgmt-label" for="pass">Password</label>
                <input id="pass" type="password" name="password" autocomplete="current-password" required>
            </div>
            <div id="row-2fa" class="mgmt-login-field" hidden>
                <label class="mgmt-label" for="twofa">2FA</label>
                <input id="twofa" name="twofa" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code">
            </div>
            <div class="mgmt-login-actions">
                <button type="submit" class="mgmt-btn mgmt-btn-primary" id="btn-pass">Sign in</button>
            </div>
        </form>
        <form id="form-pk" class="mgmt-login-divider">
            <p class="mgmt-p mgmt-note">Use a saved passkey on this device; your browser can choose one without a username.</p>
            <div class="mgmt-login-actions">
                <button type="submit" class="mgmt-btn mgmt-btn-primary" id="btn-pk">Sign in with passkey</button>
            </div>
        </form>
        <p id="msg" class="mgmt-login-msg" role="alert"></p>
        <p class="mgmt-p mgmt-note"><a href="/register.html">Create an account</a> — ask an operator for the invite secret on the <a href="accounts.html">Accounts</a> page when <code>MANAGEMENT_REGISTRATION_SECRET</code> is set.</p>
        <p class="mgmt-p mgmt-note mgmt-login-footnote">Access from this machine (loopback or this host&rsquo;s IP behind a local reverse proxy) does not require sign-in. Use SSH port forwarding if you use the management URL from another device.</p>
    </section>
</div>`;

        const params = new URLSearchParams(location.search);
        const ret = safeReturn(params.get("return"));
        const client = new AuthClient({ baseUrl: "/api", apiVersion: "v1" });
        const msg = this.querySelector("#msg");
        const row2fa = this.querySelector("#row-2fa");
        const twofa = this.querySelector("#twofa");

        const showErr = e => {
            const m = e?.message || String(e);
            if (msg) msg.textContent = m;
        };

        const hide2fa = () => {
            if (row2fa) row2fa.hidden = true;
            if (twofa) twofa.value = "";
        };

        this.querySelector("#user")?.addEventListener("input", hide2fa);
        this.querySelector("#pass")?.addEventListener("input", hide2fa);

        fetch("/api/v1/health", { credentials: "include" })
            .then(r => {
                if (r.ok && r.headers.get("X-Management-Local-Operator") === "1") {
                    document.body.classList.add("mgmt-local-operator");
                }
            })
            .catch(() => {});

        (async () => {
            try {
                const probe = await fetch("/api/v1/health", { credentials: "include" });
                if (probe.ok && probe.headers.get("X-Management-Local-Operator") === "1") {
                    location.replace(ret);
                }
            } catch {
                /* stay on login */
            }
        })();

        this.querySelector("#form-pass")?.addEventListener("submit", async e => {
            e.preventDefault();
            const u = this.querySelector("#user")?.value?.trim() ?? "";
            const p = this.querySelector("#pass")?.value ?? "";
            const btn = this.querySelector("#btn-pass");
            const twoFaVisible = row2fa && !row2fa.hidden;
            const totp = twoFaVisible ? twofa?.value?.trim() ?? "" : undefined;

            if (twoFaVisible && !totp) {
                showErr({ message: "Enter your 2FA code." });
                twofa?.focus();
                return;
            }

            if (msg) msg.textContent = "";
            btn.disabled = true;
            try {
                await client.login(u, p, totp || undefined);
                location.assign(ret);
            } catch (err) {
                if (needs2faResponse(err)) {
                    if (row2fa) row2fa.hidden = false;
                    twofa?.focus();
                    showErr(err);
                } else {
                    showErr(err);
                }
            } finally {
                btn.disabled = false;
            }
        });

        this.querySelector("#form-pk")?.addEventListener("submit", async e => {
            e.preventDefault();
            const btn = this.querySelector("#btn-pk");
            if (msg) msg.textContent = "";
            btn.disabled = true;
            try {
                await client.loginWithPasskey();
                location.assign(ret);
            } catch (err) {
                showErr(err);
            } finally {
                btn.disabled = false;
            }
        });
    }
}
