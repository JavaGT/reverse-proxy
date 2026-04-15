/**
 * Management UI entry: registers custom elements and global listeners (theme, refresh, help).
 */

import { RpPanelToolbar } from "./components/rp-panel-toolbar.mjs";
import { RpMgmtModal } from "./components/rp-mgmt-modal.mjs";
import { RpApexDomainsPanel } from "./components/rp-apex-domains-panel.mjs";
import { RpRoutesPanel } from "./components/rp-routes-panel.mjs";
import { RpReserveForm } from "./components/rp-reserve-form.mjs";
import { RpScanPanel } from "./components/rp-scan-panel.mjs";
import { RpDdnsPanel } from "./components/rp-ddns-panel.mjs";
import { RpNetworkPanel } from "./components/rp-network-panel.mjs";

customElements.define("rp-panel-toolbar", RpPanelToolbar);
customElements.define("rp-mgmt-modal", RpMgmtModal);
customElements.define("rp-apex-domains-panel", RpApexDomainsPanel);
customElements.define("rp-routes-panel", RpRoutesPanel);
customElements.define("rp-reserve-form", RpReserveForm);
customElements.define("rp-scan-panel", RpScanPanel);
customElements.define("rp-ddns-panel", RpDdnsPanel);
customElements.define("rp-network-panel", RpNetworkPanel);

const secretEl = document.getElementById("mgmt-secret");
if (secretEl) {
    const saved = sessionStorage.getItem("mgmt_secret");
    if (saved) secretEl.value = saved;
    secretEl.addEventListener("input", () => sessionStorage.setItem("mgmt_secret", secretEl.value));
}

document.getElementById("refresh-all")?.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("mgmt-refresh"));
});

(function wireHelpModal() {
    const modal = document.getElementById("help-modal");
    const open = () => {
        if (modal && typeof modal.showModal === "function") modal.showModal();
    };
    const close = () => {
        if (modal && typeof modal.close === "function") modal.close();
    };
    document.getElementById("open-help")?.addEventListener("click", open);
    document.getElementById("open-help-inline")?.addEventListener("click", open);
    document.body.addEventListener("click", e => {
        if (e.target.closest("[data-open-help]")) open();
    });
    document.getElementById("help-modal-close")?.addEventListener("click", close);
})();

document.body.addEventListener("click", e => {
    const btn = e.target.closest(".mgmt-table-toggle");
    if (!btn) return;
    const root = btn.closest(".mgmt-table-collapsible");
    if (!root) return;
    root.classList.toggle("mgmt-table-collapsed");
    const collapsed = root.classList.contains("mgmt-table-collapsed");
    btn.textContent = collapsed ? "Expand" : "Collapse";
    btn.setAttribute("aria-expanded", String(!collapsed));
});

const THEME_KEY = "mgmt_theme";
const THEME_CYCLE_ORDER = ["system", "light", "dark"];
const THEME_CYCLE_LABELS = { system: "System", light: "Light", dark: "Dark" };

function normalizeMgmtThemeMode(raw) {
    return raw === "light" || raw === "dark" ? raw : "system";
}

function getCurrentMgmtThemeMode() {
    const a = document.documentElement.getAttribute("data-theme");
    if (a === "light" || a === "dark") return a;
    return "system";
}

function nextMgmtThemeMode(mode) {
    const m = normalizeMgmtThemeMode(mode);
    const i = THEME_CYCLE_ORDER.indexOf(m);
    const idx = i === -1 ? 0 : i;
    return THEME_CYCLE_ORDER[(idx + 1) % THEME_CYCLE_ORDER.length];
}

function syncMgmtThemeCycleButton(btn, mode) {
    const m = normalizeMgmtThemeMode(mode);
    const label = THEME_CYCLE_LABELS[m];
    const nextLabel = THEME_CYCLE_LABELS[nextMgmtThemeMode(m)];
    btn.textContent = label;
    btn.setAttribute("aria-label", `Color theme: ${label}. Activate to use ${nextLabel}.`);
    btn.title = `Cycle: ${THEME_CYCLE_ORDER.map(k => THEME_CYCLE_LABELS[k]).join(" → ")}`;
}

function applyMgmtTheme(mode) {
    const root = document.documentElement;
    const m = normalizeMgmtThemeMode(mode);
    if (m === "light") root.setAttribute("data-theme", "light");
    else if (m === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    try {
        localStorage.setItem(THEME_KEY, m);
    } catch {
        /* ignore */
    }
}

const themeCycleBtn = document.getElementById("theme-cycle-btn");
if (themeCycleBtn) {
    const saved = (() => {
        try {
            return localStorage.getItem(THEME_KEY);
        } catch {
            return null;
        }
    })();
    const initial = normalizeMgmtThemeMode(saved);
    applyMgmtTheme(initial);
    syncMgmtThemeCycleButton(themeCycleBtn, initial);
    themeCycleBtn.addEventListener("click", () => {
        const next = nextMgmtThemeMode(getCurrentMgmtThemeMode());
        applyMgmtTheme(next);
        syncMgmtThemeCycleButton(themeCycleBtn, next);
    });
}

document.dispatchEvent(new CustomEvent("mgmt-refresh"));
