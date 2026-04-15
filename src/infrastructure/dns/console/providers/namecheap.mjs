/**
 * Namecheap account DNS (logged-in session required in browser).
 * @see https://www.namecheap.com/
 */
export const namecheapDnsConsole = {
    id: "namecheap",
    label: "Namecheap",

    /** @param {string} apex - Lowercase FQDN */
    buildManagementUrl(apex) {
        const d = String(apex ?? "")
            .trim()
            .toLowerCase();
        if (!d) return null;
        return `https://ap.www.namecheap.com/Domains/DomainControlPanel/${encodeURIComponent(d)}/advancedns`;
    }
};
