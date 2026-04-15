/** Sign-out and global refresh broadcast (pages with matching controls). */

export function wireMgmtSignOut() {
    document.getElementById("mgmt-sign-out")?.addEventListener("click", async () => {
        try {
            await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
        } catch {
            /* still navigate away */
        }
        location.assign("/login.html");
    });
}

export function wireMgmtRefresh() {
    document.getElementById("refresh-all")?.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("mgmt-refresh"));
    });
}

export function initMgmtSessionBar() {
    wireMgmtSignOut();
    wireMgmtRefresh();
}
