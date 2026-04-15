/**
 * Registration page (invite secret + account creation).
 */

import { messageFromErrorBody } from "../api-client.mjs";

export class RpAuthRegister extends HTMLElement {
    connectedCallback() {
        if (this.dataset.wired) return;
        this.dataset.wired = "1";

        this.innerHTML = `
<div class="mgmt-login-wrap">
    <header class="mgmt-masthead">
        <h1>Create account</h1>
        <p class="mgmt-sub">Ask an operator for the invite secret from the <a href="accounts.html">Accounts</a> page when registration is configured.</p>
    </header>
    <section class="mgmt-section">
        <form id="form-reg" autocomplete="on">
            <div class="mgmt-login-field">
                <label class="mgmt-label" for="user">Username</label>
                <input id="user" name="username" type="text" autocomplete="username" spellcheck="false" required>
            </div>
            <div class="mgmt-login-field">
                <label class="mgmt-label" for="email">Email</label>
                <input id="email" name="email" type="email" autocomplete="email" required>
            </div>
            <div class="mgmt-login-field">
                <label class="mgmt-label" for="pass">Password</label>
                <input id="pass" type="password" name="password" autocomplete="new-password" required>
            </div>
            <div class="mgmt-login-field">
                <label class="mgmt-label" for="secret">Registration secret</label>
                <input id="secret" name="registrationSecret" type="password" autocomplete="off" required>
            </div>
            <div class="mgmt-login-actions">
                <button type="submit" class="mgmt-btn mgmt-btn-primary" id="btn-reg">Create account</button>
            </div>
        </form>
        <p id="msg" class="mgmt-login-msg" role="alert" aria-live="assertive"></p>
        <p class="mgmt-p mgmt-note"><a href="/login.html">Back to sign in</a></p>
        <p class="mgmt-p mgmt-note mgmt-login-footnote">Access from this machine (loopback or this host&rsquo;s IP behind a local reverse proxy) does not require sign-in. Use SSH port forwarding if you use the management URL from another device.</p>
    </section>
</div>`;

        const msg = this.querySelector("#msg");

        fetch("/api/v1/health", { credentials: "include" })
            .then(r => {
                if (r.ok && r.headers.get("X-Management-Local-Operator") === "1") {
                    document.body.classList.add("mgmt-local-operator");
                }
            })
            .catch(() => {});

        this.querySelector("#form-reg")?.addEventListener("submit", async e => {
            e.preventDefault();
            const username = this.querySelector("#user")?.value?.trim() ?? "";
            const email = this.querySelector("#email")?.value?.trim() ?? "";
            const password = this.querySelector("#pass")?.value ?? "";
            const registrationSecret = this.querySelector("#secret")?.value ?? "";
            const btn = this.querySelector("#btn-reg");
            if (msg) msg.textContent = "";
            btn.disabled = true;
            try {
                const res = await fetch("/api/v1/auth/register", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({ username, email, password, registrationSecret })
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(messageFromErrorBody(body, res.status));
                }
                location.assign("/login.html?return=%2F");
            } catch (err) {
                if (msg) msg.textContent = err?.message || String(err);
            } finally {
                btn.disabled = false;
            }
        });
    }
}
