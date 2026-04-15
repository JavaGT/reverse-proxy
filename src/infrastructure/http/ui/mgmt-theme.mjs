/** Theme cycle (system / light / dark) persisted in localStorage. */

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

export function initMgmtTheme() {
    const themeCycleBtn = document.getElementById("theme-cycle-btn");
    if (!themeCycleBtn) return;
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
