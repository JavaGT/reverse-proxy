import { porkbunDnsConsole } from "./providers/porkbun.mjs";
import { namecheapDnsConsole } from "./providers/namecheap.mjs";

/**
 * Pluggable DNS registrar / DNS host "open management UI" links.
 * Add providers here and expose their ids in API validation.
 */
const byId = new Map([
    [porkbunDnsConsole.id, porkbunDnsConsole],
    [namecheapDnsConsole.id, namecheapDnsConsole]
]);

/** @returns {readonly string[]} */
export function listDnsConsoleProviderIds() {
    return [...byId.keys()].sort();
}

/** @param {string} id */
export function getDnsConsoleProvider(id) {
    return byId.get(String(id).trim().toLowerCase()) ?? null;
}

/**
 * @param {string} providerId
 * @param {string} apex
 * @returns {string | null}
 */
export function buildDnsConsoleUrl(providerId, apex) {
    const p = getDnsConsoleProvider(providerId);
    if (!p?.buildManagementUrl) return null;
    return p.buildManagementUrl(apex);
}
