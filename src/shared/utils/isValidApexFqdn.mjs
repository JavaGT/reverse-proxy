/** Validates a DNS hostname (apex FQDN), lowercase labels. */
export function isValidApexFQDN(s) {
    const t = String(s).trim().toLowerCase();
    if (!t || t.length > 253) return false;
    const labels = t.split(".");
    for (const label of labels) {
        if (label.length < 1 || label.length > 63) return false;
        if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return false;
    }
    return true;
}
