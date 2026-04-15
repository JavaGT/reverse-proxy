/**
 * Porkbun account DNS / domain management (logged-in session required in browser).
 * @see https://porkbun.com/
 */
export const porkbunDnsConsole = {
    id: "porkbun",
    label: "Porkbun",

    /** @param {string} apex - Lowercase FQDN */
    buildManagementUrl(apex) {
        const d = String(apex ?? "")
            .trim()
            .toLowerCase();
        if (!d) return null;
        return `https://porkbun.com/account/domain/${encodeURIComponent(d)}`;
    }
};
