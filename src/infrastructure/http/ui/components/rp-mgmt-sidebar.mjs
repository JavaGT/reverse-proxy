/**
 * Vertical management navigation (replaces duplicated header links).
 *
 * Attributes:
 * - `variant` — `dashboard` (index: section hashes + other pages), `pages` (settings/accounts/ddns),
 *   `auth` (login/register).
 * - `current` — for `pages`: `settings` | `accounts` | `ddns`. For `auth`: `login` | `register`.
 *
 * Dashboard variant toggles `hidden` on elements `#overview` … `#api` and syncs with `location.hash`.
 */

const DASHBOARD_SECTION_IDS = ["overview", "routes", "domains", "network", "scanner", "api"];

export class RpMgmtSidebar extends HTMLElement {
    /** @type {(() => void) | null} */
    #hashListener = null;

    connectedCallback() {
        if (this.dataset.rendered) return;
        this.dataset.rendered = "1";

        const variant = this.getAttribute("variant") || "pages";
        const current = this.getAttribute("current") || "";

        if (variant === "dashboard") {
            this.innerHTML = this.#dashboardHtml();
            this.#hashListener = () => this.#syncDashboardFromHash();
            window.addEventListener("hashchange", this.#hashListener);
            /* Defer until sibling shell-main and section panels are parsed. */
            setTimeout(() => this.#syncDashboardFromHash(), 0);
        } else if (variant === "auth") {
            this.innerHTML = this.#authHtml(current);
        } else {
            this.innerHTML = this.#pagesHtml(current);
        }
    }

    disconnectedCallback() {
        if (this.#hashListener) {
            window.removeEventListener("hashchange", this.#hashListener);
            this.#hashListener = null;
        }
    }

    #dashboardHtml() {
        const sections = DASHBOARD_SECTION_IDS.map(
            id =>
                `<a href="#${id}" class="mgmt-sidebar-link" data-section="${id}">${this.#sectionLabel(id)}</a>`
        ).join("\n            ");
        return `<nav class="mgmt-sidebar-nav" aria-label="Management">
            <div class="mgmt-sidebar-group">
                <p class="mgmt-sidebar-label" id="mgmt-sidebar-lbl-host">This host</p>
                <div class="mgmt-sidebar-group-links" role="group" aria-labelledby="mgmt-sidebar-lbl-host">
            ${sections}
                </div>
            </div>
            <div class="mgmt-sidebar-group">
                <p class="mgmt-sidebar-label" id="mgmt-sidebar-lbl-pages">Other pages</p>
                <div class="mgmt-sidebar-group-links" role="group" aria-labelledby="mgmt-sidebar-lbl-pages">
                    <a href="settings.html" class="mgmt-sidebar-link">Settings</a>
                    <a href="accounts.html" class="mgmt-sidebar-link">Accounts</a>
                    <a href="ddns.html" class="mgmt-sidebar-link">DDNS</a>
                </div>
            </div>
        </nav>`;
    }

    /** @param {string} id */
    #sectionLabel(id) {
        const labels = {
            overview: "Overview",
            routes: "Routes",
            domains: "Domains",
            network: "Network",
            scanner: "Scanner",
            api: "API"
        };
        return labels[id] || id;
    }

    #pagesHtml(current) {
        const row = (key, href, label) => {
            const on = current === key;
            return on
                ? `<span class="mgmt-sidebar-link is-active" aria-current="page">${label}</span>`
                : `<a href="${href}" class="mgmt-sidebar-link">${label}</a>`;
        };
        return `<nav class="mgmt-sidebar-nav" aria-label="Management">
            ${row("dashboard", "index.html#overview", "Dashboard")}
            ${row("settings", "settings.html", "Settings")}
            ${row("accounts", "accounts.html", "Accounts")}
            ${row("ddns", "ddns.html", "DDNS")}
        </nav>`;
    }

    /** @param {string} current */
    #authHtml(current) {
        const row = (key, href, label) => {
            const on = current === key;
            return on
                ? `<span class="mgmt-sidebar-link is-active" aria-current="page">${label}</span>`
                : `<a href="${href}" class="mgmt-sidebar-link">${label}</a>`;
        };
        return `<nav class="mgmt-sidebar-nav" aria-label="Account">
            ${row("dashboard", "index.html#overview", "Management")}
            ${row("login", "login.html", "Sign in")}
            ${row("register", "register.html", "Create account")}
        </nav>`;
    }

    #panelIdFromHash() {
        const h = (location.hash || "#overview").replace(/^#/, "");
        return DASHBOARD_SECTION_IDS.includes(h) ? h : "overview";
    }

    #syncDashboardFromHash() {
        const raw = (location.hash || "").replace(/^#/, "");
        if (location.hash && !DASHBOARD_SECTION_IDS.includes(raw)) {
            try {
                history.replaceState(null, "", "#overview");
            } catch {
                /* ignore */
            }
        }
        const id = this.#panelIdFromHash();
        if (location.hash === "" && id === "overview") {
            try {
                history.replaceState(null, "", "#overview");
            } catch {
                /* ignore */
            }
        }

        for (const tid of DASHBOARD_SECTION_IDS) {
            const el = document.getElementById(tid);
            if (el) el.hidden = tid !== id;
        }

        this.querySelectorAll(".mgmt-sidebar-link[data-section]").forEach(a => {
            const tid = a.getAttribute("data-section") || "";
            const on = tid === id;
            a.classList.toggle("is-active", on);
            if (on) a.setAttribute("aria-current", "page");
            else a.removeAttribute("aria-current");
        });
    }
}
