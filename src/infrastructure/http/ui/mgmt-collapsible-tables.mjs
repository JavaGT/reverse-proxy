/** Delegated click handler for expandable/collapsible mgmt tables. */

export function initMgmtCollapsibleTables() {
    document.body.addEventListener("click", e => {
        const btn = e.target.closest(".mgmt-table-toggle");
        if (!btn) return;
        const root = btn.closest(".mgmt-table-collapsible");
        if (!root) return;
        root.classList.toggle("mgmt-table-collapsed");
        const collapsed = root.classList.contains("mgmt-table-collapsed");
        btn.textContent = collapsed ? "Show table" : "Hide table";
        btn.setAttribute("aria-expanded", String(!collapsed));
    });
}
