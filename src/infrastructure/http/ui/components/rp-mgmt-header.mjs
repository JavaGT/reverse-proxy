/**
 * App chrome: skip link + top bar (brand, tools only — section links live in rp-mgmt-sidebar).
 * Attributes: tagline, brand-href, tools (comma: signout,theme,help,refresh).
 */

export class RpMgmtHeader extends HTMLElement {
    connectedCallback() {
        if (this.dataset.rendered) return;
        this.dataset.rendered = "1";

        const tagline = this.getAttribute("tagline") || "";
        const brandHref = this.getAttribute("brand-href") ?? "index.html#overview";
        const tools = (this.getAttribute("tools") || "signout,theme,help,refresh")
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);

        const parts = [];
        if (tools.includes("signout")) {
            parts.push(
                `<button type="button" class="mgmt-btn" id="mgmt-sign-out" title="End session" aria-label="Sign out of management">Sign out</button>`
            );
        }
        if (tools.includes("theme")) {
            parts.push(`<span class="mgmt-theme-label">Theme</span>`);
            parts.push(
                `<button type="button" class="mgmt-btn mgmt-theme-cycle" id="theme-cycle-btn">System</button>`
            );
        }
        if (tools.includes("help")) {
            parts.push(
                `<button type="button" class="mgmt-btn" id="open-help" title="Help (?) column meanings and badges" aria-label="Open help">Help</button>`
            );
        }
        if (tools.includes("refresh")) {
            parts.push(
                `<button type="button" class="mgmt-btn mgmt-btn-primary" id="refresh-all" aria-label="Reload data on this page">Refresh page</button>`
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
    </div>
</header>`;
    }
}
