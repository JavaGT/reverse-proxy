import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PortScanner } from "../shared/utils/PortScanner.mjs";
import { ProcessInfoProvider } from "../shared/utils/ProcessInfoProvider.mjs";
import { sendJsonError } from "../shared/utils/JsonError.mjs";
import { resolutionForManagementError } from "./managementErrorResolutions.mjs";
import { normalizeReserveOptions, ReserveValidationError } from "../shared/utils/ReserveOptions.mjs";
import { listDnsConsoleProviderIds } from "../infrastructure/dns/console/DnsConsoleRegistry.mjs";
import {
    assertValidDnsConsoleConfig,
    normalizeDnsConsoleInput,
    resolveDnsConsoleLinks
} from "../infrastructure/dns/console/resolveConsoleLinks.mjs";
import { collectNetworkStatus } from "../infrastructure/network/networkStatus.mjs";
import { buildDdnsPublicSummary, mergePutDdnsBody } from "../ddns/ddnsConfigResolve.mjs";
import { runDdnsSyncOnce } from "../ddns/runDdnsSyncOnce.mjs";
import { SqliteIpCache } from "../ddns/infrastructure/adapters/SqliteIpCache.mjs";
import { isValidApexFQDN } from "../shared/utils/isValidApexFqdn.mjs";
import {
    parseReservationTargets,
    reserveWithRegistryOutcome,
    subdomainConflictMessage
} from "./reservationOps.mjs";
import { deleteManagementAccount, listManagementAccounts } from "./managementAccounts.mjs";
import { buildPublicSettingsView, SERVER_SETTINGS_RESTART_KEYS } from "../config/serverSettingsRegistry.mjs";
import { reapplyServerSettingsFromPersistence } from "../config/applyServerSettingsToEnv.mjs";
import { validateServerSettingsPut } from "../config/validateServerSettingsPut.mjs";

function sendApiError(res, status, code, message, details = null) {
    return sendJsonError(res, status, code, message, details, resolutionForManagementError(code));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * SRP: Contains the business logic for management API routes.
 * RESTful: Supports HA with multi-target reservation.
 */
export class ManagementController {
    #registry;
    #persistence;
    #logger;
    #publicUrlHttpsPrefix;
    #publicUrlHttpPrefix;
    /** @type {(() => void) | null} */
    #onRootDomainsUpdated;

    /**
     * @param {*} registry
     * @param {*} persistence
     * @param {*} logger
     * @param {{ publicUrlHttpsPrefix?: string, publicUrlHttpPrefix?: string, onRootDomainsUpdated?: () => void } | null} [publicUrls]
     */
    constructor(registry, persistence, logger, publicUrls = null) {
        this.#registry = registry;
        this.#persistence = persistence;
        this.#logger = logger;
        this.#publicUrlHttpsPrefix = publicUrls?.publicUrlHttpsPrefix ?? "https";
        this.#publicUrlHttpPrefix = publicUrls?.publicUrlHttpPrefix ?? "http";
        this.#onRootDomainsUpdated = publicUrls?.onRootDomainsUpdated ?? null;
    }

    get registry() {
        return this.#registry;
    }

    #publicFieldsForHost(host) {
        const baseDomain = this.#registry.baseDomainForHost(host);
        return {
            baseDomain,
            rootDomain: baseDomain,
            publicUrl: `${this.#publicUrlHttpsPrefix}://${host}`,
            publicUrlHttp: `${this.#publicUrlHttpPrefix}://${host}`
        };
    }

    /**
     * DDNS API payload including SQLite public IP cache and last-run telemetry (no secrets).
     */
    async #getDdnsDataObject() {
        const stored =
            typeof this.#persistence.getDdnsSettings === "function" ? this.#persistence.getDdnsSettings() : null;
        const summary = buildDdnsPublicSummary({
            getApexDomains: () => this.#registry.getRootDomains(),
            stored
        });

        let cachedPublicIp = null;
        const getDb = this.#persistence.getDatabaseSync?.bind(this.#persistence);
        if (typeof getDb === "function") {
            try {
                const cache = new SqliteIpCache(getDb());
                const ip = await cache.read();
                cachedPublicIp = ip ? ip.toJSON() : null;
            } catch (err) {
                this.#logger.warn({ event: "mgmt_ddns_cache_read_error", error: err.message }, "DDNS cache read failed");
            }
        }

        const lastRun =
            typeof this.#persistence.getDdnsLastRun === "function" ? this.#persistence.getDdnsLastRun() : null;

        return { ...summary, cachedPublicIp, lastRun };
    }

    getDomains(req, res) {
        const apexDomains = this.#registry.getRootDomains();
        const cfg = this.#persistence.getRootDomainConfig?.() ?? null;
        const dnsConsole = cfg?.dnsConsole ?? null;
        const dnsConsoleLinks = resolveDnsConsoleLinks(apexDomains, dnsConsole ?? undefined);

        res.status(200).json({
            data: {
                primary: this.#registry.rootDomain,
                apexDomains,
                dnsConsole,
                dnsConsoleLinks,
                dnsConsoleProviderIds: listDnsConsoleProviderIds()
            }
        });
    }

    async putDomains(req, res) {
        try {
            const apexDomains = req.body?.apexDomains;
            if (!Array.isArray(apexDomains)) {
                return sendApiError(res, 400, "INVALID_REQUEST", "apexDomains must be an array", null);
            }

            const normalized = [];
            const seen = new Set();
            for (const d of apexDomains) {
                const x = String(d ?? "")
                    .trim()
                    .toLowerCase();
                if (!x || seen.has(x)) continue;
                if (!isValidApexFQDN(x)) {
                    return sendApiError(res, 400, "INVALID_REQUEST", `Invalid apex domain: ${d}`, null);
                }
                seen.add(x);
                normalized.push(x);
            }

            if (normalized.length === 0) {
                return sendApiError(res, 400, "INVALID_REQUEST", "At least one unique apex domain is required", null);
            }

            try {
                this.#registry.setRootDomains(normalized);
            } catch (err) {
                return sendApiError(res, 400, "DOMAIN_CONFLICT", err.message, null);
            }

            let nextDnsConsole;
            if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "dnsConsole")) {
                const raw = req.body.dnsConsole;
                if (raw === null) {
                    nextDnsConsole = null;
                } else {
                    const norm = normalizeDnsConsoleInput(raw);
                    if (norm === null && raw != null && typeof raw === "object") {
                        return sendApiError(res, 400, "INVALID_REQUEST", "Invalid dnsConsole shape", null);
                    }
                    if (norm) {
                        try {
                            assertValidDnsConsoleConfig(norm);
                        } catch (e) {
                            return sendApiError(res, 400, "INVALID_REQUEST", e.message, null);
                        }
                    }
                    nextDnsConsole = norm;
                }
            } else {
                nextDnsConsole = this.#persistence.getRootDomainConfig?.()?.dnsConsole;
            }

            try {
                await this.#persistence.saveRootDomainConfig({
                    apexDomains: normalized,
                    dnsConsole: nextDnsConsole
                });
                await this.#persistence.save(this.#registry.getPersistentRoutes());
            } catch (persistErr) {
                this.#logger.error(
                    { event: "mgmt_put_domains_persist_error", error: persistErr.message },
                    "Failed to persist apex domains"
                );
                return sendApiError(res, 500, "PERSISTENCE_FAILED", persistErr.message, null);
            }

            this.#onRootDomainsUpdated?.();

            const apexAfter = this.#registry.getRootDomains();
            const persisted = this.#persistence.getRootDomainConfig?.() ?? null;
            res.status(200).json({
                data: {
                    primary: this.#registry.rootDomain,
                    apexDomains: apexAfter,
                    dnsConsole: persisted?.dnsConsole ?? null,
                    dnsConsoleLinks: resolveDnsConsoleLinks(apexAfter, persisted?.dnsConsole ?? undefined),
                    dnsConsoleProviderIds: listDnsConsoleProviderIds()
                }
            });
        } catch (error) {
            this.#logger.error({ event: "mgmt_put_domains_error", error: error.message }, "putDomains failed");
            sendApiError(res, 500, "INTERNAL_SERVER_ERROR", error.message, null);
        }
    }

    #enrichReservationPayload(result) {
        return { ...result, ...this.#publicFieldsForHost(result.host) };
    }

    async getRoutes(req, res) {
        this.#logger.info({ event: "mgmt_get_routes" }, "Listing all routes");
        const routes = this.#registry.getAllRoutes().map(r => ({
            ...r,
            ...this.#publicFieldsForHost(r.host)
        }));
        res.status(200).json({ data: routes });
    }

    async reserve(req, res) {
        try {
            if (Array.isArray(req.body?.reservations)) {
                return await this.#reserveBatch(req, res);
            }

            let normalizedOptions;
            try {
                normalizedOptions = normalizeReserveOptions(req.body?.options);
            } catch (e) {
                if (e instanceof ReserveValidationError) {
                    return sendApiError(res, 400, e.code, e.message, null);
                }
                throw e;
            }

            const { subdomain, baseDomain } = req.body;
            if (baseDomain == null || String(baseDomain).trim() === "") {
                return sendApiError(res, 400, "INVALID_REQUEST", "baseDomain is required", null);
            }

            if (subdomain == null || String(subdomain).trim() === "") {
                return sendApiError(res, 400, "INVALID_REQUEST", "subdomain is required", null);
            }

            const reservationTargets = parseReservationTargets(req.body);
            if (!reservationTargets || (Array.isArray(reservationTargets) && reservationTargets.length === 0)) {
                return sendApiError(res, 400, "INVALID_REQUEST", "targets, ports, or port is required", null);
            }

            const outcome = reserveWithRegistryOutcome(
                this.#registry,
                subdomain,
                String(baseDomain).trim().toLowerCase(),
                normalizedOptions,
                reservationTargets
            );

            if (outcome.outcome === "conflict") {
                return sendApiError(res, 409, "SUBDOMAIN_CONFLICT", subdomainConflictMessage(outcome), {
                    host: outcome.host,
                    reason: outcome.reason
                });
            }

            const payload = this.#enrichReservationPayload(outcome.data);

            if (outcome.outcome === "unchanged") {
                this.#logger.info({ event: "mgmt_reserve_idempotent", host: payload.host }, `Idempotent reserve for ${payload.host}`);
                return res.status(200).json({ data: payload });
            }

            this.#logger.info(
                { event: "mgmt_reserve", host: payload.host },
                `Reserved ${payload.host} with ${payload.targets.length} target(s)`
            );
            try {
                await this.#persistence.save(this.#registry.getPersistentRoutes());
            } catch (persistErr) {
                this.#logger.error(
                    { event: "mgmt_reserve_persist_error", error: persistErr.message },
                    "Failed to persist routes after reserve"
                );
                return sendApiError(res, 500, "PERSISTENCE_FAILED", persistErr.message, null);
            }

            res.status(201).json({ data: payload });
        } catch (error) {
            this.#logger.error({ event: "mgmt_reserve_error", error: error.message }, "Reservation failed");
            if (error instanceof ReserveValidationError) {
                return sendApiError(res, 400, error.code, error.message, null);
            }
            if (error.message.includes("is not configured") && error.message.includes("allowed:")) {
                return sendApiError(res, 400, "INVALID_REQUEST", error.message, null);
            }
            sendApiError(res, 400, "RESERVATION_FAILED", error.message, null);
        }
    }

    #rollbackReserveBatch(createdStack) {
        for (const { subdomain, baseDomain } of createdStack.slice().reverse()) {
            try {
                this.#registry.release(subdomain, baseDomain);
            } catch (err) {
                this.#logger.error(
                    { event: "mgmt_batch_rollback_error", subdomain, baseDomain, error: err.message },
                    "Batch rollback release failed"
                );
            }
        }
    }

    async #reserveBatch(req, res) {
        const items = req.body?.reservations;
        if (!Array.isArray(items) || items.length === 0) {
            return sendApiError(res, 400, "INVALID_REQUEST", "reservations must be a non-empty array", null);
        }

        const createdStack = [];
        const results = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i] ?? {};

            let normalizedOptions;
            try {
                normalizedOptions = normalizeReserveOptions(item.options);
            } catch (e) {
                this.#rollbackReserveBatch(createdStack);
                if (e instanceof ReserveValidationError) {
                    return sendApiError(res, 400, e.code, `reservations[${i}]: ${e.message}`, null);
                }
                throw e;
            }

            const baseDomainRaw = item.baseDomain;
            if (baseDomainRaw == null || String(baseDomainRaw).trim() === "") {
                this.#rollbackReserveBatch(createdStack);
                return sendApiError(res, 400, "INVALID_REQUEST", `reservations[${i}]: baseDomain is required`, null);
            }
            const baseDomain = String(baseDomainRaw).trim().toLowerCase();

            if (item.subdomain == null || String(item.subdomain).trim() === "") {
                this.#rollbackReserveBatch(createdStack);
                return sendApiError(res, 400, "INVALID_REQUEST", `reservations[${i}]: subdomain is required`, null);
            }

            const reservationTargets = parseReservationTargets(item);
            if (!reservationTargets || (Array.isArray(reservationTargets) && reservationTargets.length === 0)) {
                this.#rollbackReserveBatch(createdStack);
                return sendApiError(
                    res,
                    400,
                    "INVALID_REQUEST",
                    `reservations[${i}]: targets, ports, or port is required`,
                    null
                );
            }

            let outcome;
            try {
                outcome = reserveWithRegistryOutcome(
                    this.#registry,
                    item.subdomain,
                    baseDomain,
                    normalizedOptions,
                    reservationTargets
                );
            } catch (err) {
                this.#rollbackReserveBatch(createdStack);
                if (err.message.includes("is not configured") && err.message.includes("allowed:")) {
                    return sendApiError(res, 400, "INVALID_REQUEST", `reservations[${i}]: ${err.message}`, null);
                }
                return sendApiError(res, 400, "RESERVATION_FAILED", `reservations[${i}]: ${err.message}`, null);
            }

            if (outcome.outcome === "conflict") {
                this.#rollbackReserveBatch(createdStack);
                return sendApiError(res, 409, "SUBDOMAIN_CONFLICT", subdomainConflictMessage(outcome), {
                    host: outcome.host,
                    reason: outcome.reason,
                    index: i
                });
            }

            const payload = this.#enrichReservationPayload(outcome.data);
            results.push({ outcome: outcome.outcome, data: payload });

            if (outcome.outcome === "created") {
                createdStack.push({ subdomain: item.subdomain, baseDomain });
            }
        }

        try {
            await this.#persistence.save(this.#registry.getPersistentRoutes());
        } catch (persistErr) {
            this.#logger.error(
                { event: "mgmt_reserve_batch_persist_error", error: persistErr.message },
                "Failed to persist batch reservations"
            );
            this.#rollbackReserveBatch(createdStack);
            return sendApiError(res, 500, "PERSISTENCE_FAILED", persistErr.message, null);
        }

        const anyCreated = results.some(r => r.outcome === "created");
        res.status(anyCreated ? 201 : 200).json({ data: { batch: true, results } });
    }

    async release(req, res) {
        try {
            const { subdomain } = req.params;
            const baseDomain = req.query.baseDomain;
            if (baseDomain == null || String(baseDomain).trim() === "") {
                return sendApiError(res, 400, "INVALID_REQUEST", "baseDomain query parameter is required", null);
            }

            const result = this.#registry.release(subdomain, baseDomain);

            if (!result) {
                return sendApiError(res, 404, "ROUTE_NOT_FOUND", "Route not found", null);
            }

            this.#logger.info({ event: "mgmt_release", host: result.host }, `Released ${result.host}`);
            try {
                await this.#persistence.save(this.#registry.getPersistentRoutes());
            } catch (persistErr) {
                this.#logger.error(
                    { event: "mgmt_release_persist_error", error: persistErr.message },
                    "Failed to persist routes after release"
                );
                return sendApiError(res, 500, "PERSISTENCE_FAILED", persistErr.message, null);
            }

            res.status(200).json({ data: { ...result, ...this.#publicFieldsForHost(result.host) } });
        } catch (error) {
            this.#logger.error({ event: "mgmt_release_error", error: error.message }, "Release failed");
            if (error.message.includes("baseDomain is required")) {
                return sendApiError(res, 400, "INVALID_REQUEST", error.message, null);
            }
            sendApiError(res, 400, "RELEASE_FAILED", error.message, null);
        }
    }

    async scanPorts(req, res) {
        try {
            const { start = 3000, end = 4000, concurrency = 100 } = req.body;

            const rangeSize = end - start;
            if (rangeSize < 0 || rangeSize > 10000) {
                return sendApiError(res, 400, "INVALID_RANGE", "Scan range must be between 1 and 10,000 ports", null);
            }

            this.#logger.info({ event: "mgmt_port_scan_start", start, end }, `Starting port scan from ${start} to ${end}`);

            const scanner = new PortScanner(concurrency);
            const openPorts = await scanner.scanRange(start, end);
            const processMap = ProcessInfoProvider.getListeningProcesses();

            const results = openPorts.map(port => ({
                port,
                process: processMap.get(port) || { command: "unknown", pid: "unknown" }
            }));

            this.#logger.info(
                { event: "mgmt_port_scan_complete", count: results.length },
                `Port scan complete. Found ${results.length} open port(s)`
            );

            res.status(200).json({ data: { openPorts: results } });
        } catch (error) {
            this.#logger.error({ event: "mgmt_scan_error", error: error.message }, "Port scan failed");
            sendApiError(res, 500, "SCAN_FAILED", error.message, null);
        }
    }

    async killProcess(req, res) {
        try {
            const port = parseInt(req.params.port, 10);
            if (isNaN(port)) {
                return sendApiError(res, 400, "INVALID_PORT", "Invalid port number", null);
            }

            this.#logger.warn({ event: "mgmt_kill_process", port }, `Attempting to kill process on port ${port}`);

            const killed = ProcessInfoProvider.killProcessByPort(port);

            if (killed) {
                this.#logger.info({ event: "mgmt_kill_success", port }, `Successfully killed process on port ${port}`);
                res.status(200).json({ data: { message: `Process on port ${port} terminated` } });
            } else {
                sendApiError(res, 404, "PROCESS_NOT_FOUND", `No listening process found on port ${port}`, null);
            }
        } catch (error) {
            this.#logger.error({ event: "mgmt_kill_error", port: req.params.port, error: error.message }, "Failed to kill process");
            sendApiError(res, 500, "KILL_FAILED", error.message, null);
        }
    }

    getHealth(req, res) {
        res.status(200).json({ data: { status: "OK" } });
    }

    /**
     * Returns the shared registration secret for `POST /api/v1/auth/register` (`registrationSecret` body field).
     * Allowed for same-machine operators or signed-in sessions (see ManagementServer `#requireAuth`).
     */
    getRegistrationSecret(req, res) {
        const secret = process.env.MANAGEMENT_REGISTRATION_SECRET?.trim();
        if (!secret) {
            res.status(200).json({ data: { configured: false, secret: null } });
            return;
        }
        res.status(200).json({ data: { configured: true, secret } });
    }

    /**
     * Effective server settings (SQLite overrides on top of `.env`).
     */
    getServerSettings(req, res) {
        if (typeof this.#persistence.getServerSettings !== "function") {
            return sendApiError(res, 501, "NOT_IMPLEMENTED", "Server settings require SQLite persistence", null);
        }
        try {
            const sparse = this.#persistence.getServerSettings();
            const view = buildPublicSettingsView(sparse);
            res.status(200).json({
                data: {
                    ...view,
                    bootstrapEnvKeys: ["SQLITE_DB_PATH", "NODE_ENV"]
                }
            });
        } catch (error) {
            this.#logger.error({ event: "mgmt_settings_get_error", error: error.message }, "Server settings read failed");
            sendApiError(res, 500, "INTERNAL_SERVER_ERROR", error.message, null);
        }
    }

    /**
     * Save partial settings to SQLite and merge into the running process (`process.env`).
     */
    putServerSettings(req, res) {
        if (typeof this.#persistence.saveServerSettingsPartial !== "function") {
            return sendApiError(res, 501, "NOT_IMPLEMENTED", "Server settings require SQLite persistence", null);
        }
        const validated = validateServerSettingsPut(req.body);
        if (!validated.ok) {
            return sendApiError(res, 400, "INVALID_REQUEST", validated.message, null);
        }
        try {
            this.#persistence.saveServerSettingsPartial(validated.partial);
            reapplyServerSettingsFromPersistence(this.#persistence);
            const sparse = this.#persistence.getServerSettings();
            const view = buildPublicSettingsView(sparse);
            const changed = Object.keys(validated.partial);
            const restartRecommended = changed.some(k => validated.partial[k] !== null && SERVER_SETTINGS_RESTART_KEYS.has(k));
            const clearedRestartish = changed.some(
                k => validated.partial[k] === null && SERVER_SETTINGS_RESTART_KEYS.has(k)
            );
            res.status(200).json({
                data: {
                    ...view,
                    restartRecommended: restartRecommended || clearedRestartish,
                    notice:
                        restartRecommended || clearedRestartish
                            ? "Restart the reverse-proxy process for listener port, TLS directory, health-check interval, session secret, trust proxy, rate limits, or auth data path changes to apply everywhere."
                            : "Running process updated where possible; trust proxy and rate limits may still require a restart."
                }
            });
        } catch (error) {
            this.#logger.error({ event: "mgmt_settings_put_error", error: error.message }, "Server settings save failed");
            sendApiError(res, 500, "INTERNAL_SERVER_ERROR", error.message, null);
        }
    }

    /**
     * Lists express-easy-auth accounts (for management UI).
     */
    getAccounts(req, res) {
        try {
            const accounts = listManagementAccounts();
            res.status(200).json({ data: { accounts } });
        } catch (error) {
            this.#logger.error({ event: "mgmt_accounts_list_error", error: error.message }, "Account list failed");
            sendApiError(res, 500, "INTERNAL_SERVER_ERROR", error.message, null);
        }
    }

    /**
     * Removes an account. Cannot delete own session user or the last remaining account.
     */
    deleteAccount(req, res) {
        const targetId = req.params?.userId?.trim?.() ?? String(req.params?.userId ?? "").trim();
        if (!targetId) {
            return sendApiError(res, 400, "INVALID_REQUEST", "userId is required", null);
        }
        const selfId = req.session?.userId;
        if (selfId && selfId === targetId) {
            return sendApiError(res, 409, "CANNOT_DELETE_SELF", "Cannot delete your own account from this UI", null);
        }
        try {
            const result = deleteManagementAccount(targetId);
            if (result.ok) {
                res.status(204).end();
                return;
            }
            if (result.code === "NOT_FOUND") {
                return sendApiError(res, 404, "ACCOUNT_NOT_FOUND", "No account with that id", null);
            }
            if (result.code === "LAST_ACCOUNT") {
                return sendApiError(
                    res,
                    409,
                    "CANNOT_DELETE_LAST_ACCOUNT",
                    "Cannot remove the last account; create another user first or use local operator access",
                    null
                );
            }
            return sendApiError(res, 500, "INTERNAL_SERVER_ERROR", "Unexpected delete result", null);
        } catch (error) {
            this.#logger.error({ event: "mgmt_accounts_delete_error", error: error.message }, "Account delete failed");
            sendApiError(res, 500, "INTERNAL_SERVER_ERROR", error.message, null);
        }
    }

    async getNetwork(req, res) {
        try {
            const data = await collectNetworkStatus(this.#registry);
            res.status(200).json({ data });
        } catch (error) {
            this.#logger.error({ event: "mgmt_network_error", error: error.message }, "Network status failed");
            sendApiError(res, 500, "INTERNAL_SERVER_ERROR", error.message, null);
        }
    }

    /**
     * DDNS summary from SQLite `meta.ddns` when present; otherwise unconfigured. Secrets are never returned.
     */
    async getDdns(req, res) {
        try {
            const data = await this.#getDdnsDataObject();
            res.status(200).json({ data });
        } catch (error) {
            this.#logger.error({ event: "mgmt_ddns_error", error: error.message }, "DDNS summary failed");
            sendApiError(res, 500, "INTERNAL_SERVER_ERROR", error.message, null);
        }
    }

    async putDdns(req, res) {
        if (typeof this.#persistence.getDdnsSettings !== "function" || typeof this.#persistence.saveDdnsSettings !== "function") {
            return sendApiError(res, 501, "NOT_IMPLEMENTED", "DDNS settings require SQLite persistence", null);
        }
        try {
            const prev = this.#persistence.getDdnsSettings();
            const merged = mergePutDdnsBody(prev, req.body, isValidApexFQDN);
            if (!merged.ok) {
                return sendApiError(res, 400, "INVALID_REQUEST", merged.message, null);
            }
            this.#persistence.saveDdnsSettings(merged.value);
            this.#logger.info({ event: "mgmt_ddns_saved" }, "DDNS settings saved to SQLite");

            const data = await this.#getDdnsDataObject();
            res.status(200).json({ data });
        } catch (error) {
            this.#logger.error({ event: "mgmt_ddns_put_error", error: error.message }, "DDNS save failed");
            sendApiError(res, 500, "INTERNAL_SERVER_ERROR", error.message, null);
        }
    }

    async deleteDdns(req, res) {
        if (typeof this.#persistence.clearDdnsSettings !== "function") {
            return sendApiError(res, 501, "NOT_IMPLEMENTED", "DDNS settings require SQLite persistence", null);
        }
        try {
            this.#persistence.clearDdnsSettings();
            this.#logger.info({ event: "mgmt_ddns_cleared" }, "DDNS SQLite settings cleared; configure again via PUT /api/v1/ddns or the management UI");

            const data = await this.#getDdnsDataObject();
            res.status(200).json({ data });
        } catch (error) {
            this.#logger.error({ event: "mgmt_ddns_delete_error", error: error.message }, "DDNS clear failed");
            sendApiError(res, 500, "INTERNAL_SERVER_ERROR", error.message, null);
        }
    }

    /**
     * Runs one DDNS sync immediately (same logic as the background scheduler). Requires saved SQLite settings.
     */
    async postDdnsSync(req, res) {
        if (
            typeof this.#persistence.getDdnsSettings !== "function" ||
            typeof this.#persistence.saveDdnsLastRun !== "function"
        ) {
            return sendApiError(
                res,
                501,
                "NOT_IMPLEMENTED",
                "DDNS sync requires SQLite persistence with last-run telemetry support",
                null
            );
        }
        try {
            const stored = this.#persistence.getDdnsSettings();
            if (!stored) {
                return sendApiError(
                    res,
                    400,
                    "DDNS_NOT_CONFIGURED",
                    "Save DDNS settings at least once before running a sync.",
                    null
                );
            }

            const result = await runDdnsSyncOnce({
                persistence: this.#persistence,
                getApexDomains: () => this.#registry.getRootDomains(),
                logger: this.#logger
            });

            if (!result.ran) {
                return sendApiError(
                    res,
                    400,
                    "DDNS_SYNC_IDLE",
                    "DDNS is disabled, credentials are missing, or no zones are configured.",
                    { reason: result.reason ?? null }
                );
            }

            const data = await this.#getDdnsDataObject();
            res.status(200).json({ data });
        } catch (error) {
            this.#logger.error({ event: "mgmt_ddns_sync_error", error: error.message }, "DDNS manual sync failed");
            sendApiError(res, 500, "DDNS_SYNC_FAILED", error.message, null);
        }
    }

    getOpenApi(req, res) {
        try {
            const docPath = path.join(__dirname, "openapi.yaml");
            let yaml = readFileSync(docPath, "utf-8");
            const rootDomain = this.#registry.rootDomain;
            yaml = yaml.replace(/\{\{rootDomain\}\}/g, rootDomain);
            res.set("Content-Type", "application/yaml; charset=utf-8");
            res.status(200).send(yaml);
        } catch (error) {
            this.#logger.error({ event: "mgmt_openapi_error", error: error.message }, "Failed to read OpenAPI spec");
            sendApiError(res, 500, "INTERNAL_SERVER_ERROR", "Failed to read OpenAPI specification", null);
        }
    }

    getLlmInstructions(req, res) {
        try {
            const templatePath = path.join(__dirname, "llms.txt");
            let instructions = readFileSync(templatePath, "utf-8");

            const rootDomain = this.#registry.rootDomain;
            const authNote =
                "Remote clients need a session from `@javagt/express-easy-auth` (sign in at `/login.html` or `POST /api/v1/auth/login`; cookie `mgmt.sid`). Same-machine (local operator) clients skip sign-in: logical loopback, trusted forwarded IPs matching this host, optional `MANAGEMENT_LOCAL_OPERATOR_IPS` / cached public egress (see OpenAPI). All management paths are gated until signed in when not same-machine. WebAuthn `rpID`/`origin` follow the request `Host` (and `X-Forwarded-Proto` behind a proxy); use `MANAGEMENT_TRUST_PROXY=1` when TLS terminates in front of management.";

            instructions = instructions
                .replace(/\{\{rootDomain\}\}/g, rootDomain)
                .replace(/\{\{managementAuthNote\}\}/g, authNote);

            res.set("Content-Type", "text/plain; charset=utf-8");
            res.send(instructions);
        } catch (error) {
            this.#logger.error({ event: "mgmt_llms_error", error: error.message }, "Failed to read LLM instructions");
            sendApiError(res, 500, "INTERNAL_SERVER_ERROR", "Failed to read LLM instructions", null);
        }
    }
}
