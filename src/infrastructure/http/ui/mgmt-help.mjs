/** Help modal: toolbar button, inline triggers, footer close. */

export function initMgmtHelpModal() {
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
}
