/**
 * App chrome: skip link + top bar (brand, tools, section + external nav).
 * Attributes: tagline, brand-href, tools (comma: signout,theme,help,refresh), current (settings|accounts|ddns|none).
 */

function externalNavRow(current) {
    const settings =
        current === "settings"
            ? `<span class="mgmt-app-nav-current" aria-current="page">Settings</span>`
            : `<a href="settings.html" title="Server settings (SQLite)">Settings</a>`;
    const accounts =
        current === "accounts"
            ? `<span class="mgmt-app-nav-current" aria-current="page">Accounts</span>`
            : `<a href="accounts.html" title="Accounts and registration invite">Accounts</a>`;
    const ddns =
        current === "ddns"
            ? `<span class="mgmt-app-nav-current" aria-current="page">DDNS</span>`
            : `<a href="ddns.html" class="mgmt-app-nav-ddns" title="DDNS settings (separate page)">DDNS</a>`;
    return `${settings}
                    <span class="mgmt-app-nav-ddns-sep" aria-hidden="true">·</span>
                    ${accounts}
                    <span class="mgmt-app-nav-ddns-sep" aria-hidden="true">·</span>
                    ${ddns}`;
}

export class RpMgmtHeader extends HTMLElement {
    connectedCallback() {
        if (this.dataset.rendered) return;
        this.dataset.rendered = "1";

        const tagline = this.getAttribute("tagline") || "";
        const brandHref = this.getAttribute("brand-href") ?? "index.html#overview";
        const current = this.getAttribute("current") || "none";
        const hashOnly = this.getAttribute("section-links") === "hash";
        const ix = hashOnly ? "" : "index.html";
        const h = id => (ix ? `${ix}#${id}` : `#${id}`);
        const tools = (this.getAttribute("tools") || "signout,theme,help,refresh")
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);

        const parts = [];
        if (tools.includes("signout")) {
            parts.push(
                `<button type="button" class="mgmt-btn" id="mgmt-sign-out" title="End session">Sign out</button>`
            );
        }
        if (tools.includes("theme")) {
            parts.push(`<span class="mgmt-theme-label">Theme</span>`);
            parts.push(
                `<button type="button" class="mgmt-btn mgmt-theme-cycle" id="theme-cycle-btn">System</button>`
            );
        }
        if (tools.includes("help")) {
            parts.push(`<button type="button" class="mgmt-btn" id="open-help" title="Help (?)">Help</button>`);
        }
        if (tools.includes("refresh")) {
            parts.push(
                `<button type="button" class="mgmt-btn mgmt-btn-primary" id="refresh-all">Refresh</button>`
            );
        }

        this.innerHTML = `
<a href="#main-content" class="mgmt-skip-link">Skip to main content</a>
<header class="mgmt-app-bar" role="banner">
    <div class="mgmt-app-bar-inner">
        <div class="mgmt-app-brand">
            <a href="${brandHref}" class="mgmt-app-title">Reverse proxy</a>
            <span class="mgmt-app-tagline">${tagline}</span>
        </div>
        <div class="mgmt-app-tools">
            ${parts.join("\n            ")}
        </div>
        <nav class="mgmt-app-nav" aria-label="Page sections">
            <span class="mgmt-app-nav-main">
                <a href="${h("overview")}">Overview</a>
                <a href="${h("routes")}">Routes</a>
                <a href="${h("domains")}">Domains</a>
                <a href="${h("network")}">Network</a>
                <a href="${h("scanner")}">Scanner</a>
                <a href="${h("api")}">API</a>
            </span>
            <span class="mgmt-app-nav-divider" aria-hidden="true">|</span>
            <span class="mgmt-app-nav-external">
                ${externalNavRow(current === "none" ? "" : current)}
            </span>
        </nav>
    </div>
</header>`;
    }
}
