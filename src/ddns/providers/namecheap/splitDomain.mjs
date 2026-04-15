/**
 * @param {string} fqdn - Apex zone (e.g. example.com, foo.co.uk)
 * @returns {{ sld: string, tld: string }}
 */
export function splitSldTld(fqdn) {
    const d = String(fqdn ?? "")
        .trim()
        .toLowerCase();
    if (!d) throw new Error("empty domain");

    const multi = ["co.uk", "com.au", "co.nz", "com.br", "co.za", "net.au", "org.uk"];
    for (const k of multi) {
        if (d.endsWith("." + k)) {
            const rest = d.slice(0, -(k.length + 1));
            const si = rest.lastIndexOf(".");
            const sld = si === -1 ? rest : rest.slice(si + 1);
            return { sld, tld: k };
        }
    }

    const parts = d.split(".");
    if (parts.length < 2) {
        throw new Error("invalid domain");
    }
    return { sld: parts[parts.length - 2], tld: parts[parts.length - 1] };
}
