import { HttpIpLookup } from "./infrastructure/adapters/HttpIpLookup.mjs";
import { SqliteIpCache } from "./infrastructure/adapters/SqliteIpCache.mjs";
import { SyncService } from "./domain/services/SyncService.mjs";
import { DdnsSyncUseCase } from "./application/DdnsSyncUseCase.mjs";
import { createDnsProviderForJob } from "./providers/createDnsProviderForJob.mjs";
import {
    getDdnsSchedulerPlan,
    normalizeStoredDdns,
    resolveDomainsForJob,
    snapshotDdnsResolveContext
} from "./ddnsConfigResolve.mjs";

const DETAIL_MAX = 512;

/**
 * @param {{ outcome: string, detail: string, skippedBecause?: string | null }} execResult
 * @returns {{ at: string, outcome: string, detail: string, skippedBecause: string | null }}
 */
export function ddnsLastRunRecordFromExecResult(execResult) {
    const detail = String(execResult.detail ?? "").slice(0, DETAIL_MAX);
    return {
        at: new Date().toISOString(),
        outcome: execResult.outcome,
        detail,
        skippedBecause: execResult.skippedBecause ?? null
    };
}

/**
 * @param {Error} err
 * @returns {{ at: string, outcome: 'failed', detail: string, skippedBecause: null }}
 */
export function ddnsLastRunRecordFromError(err) {
    return {
        at: new Date().toISOString(),
        outcome: "failed",
        detail: String(err?.message ?? "DDNS sync failed").slice(0, DETAIL_MAX),
        skippedBecause: null
    };
}

/**
 * @param {{ persistence: { getDatabaseSync: () => import("node:sqlite").DatabaseSync, saveDdnsLastRunForJob?: (jobId: string, r: object) => void, saveDdnsLastRun?: (r: object) => void }, logger: object, dueEntry: object }} ctx
 */
export async function runDdnsJob(ctx) {
    const { persistence, logger, dueEntry } = ctx;
    const job = dueEntry.job;
    const domains = dueEntry.domains;

    const db = persistence.getDatabaseSync();
    const ipCache = new SqliteIpCache(db, job.id);
    const syncService = new SyncService();

    const dnsProvider = createDnsProviderForJob(job, logger);

    const ipLookup = new HttpIpLookup({
        ipv4Services: job.ipv4Services,
        ipv6Services: job.ipv6Services,
        timeoutMs: job.ipLookupTimeoutMs ?? 8000,
        logger
    });

    const useCase = new DdnsSyncUseCase({
        dnsProvider,
        ipLookup,
        ipCache,
        syncService,
        logger,
        matchNote: job.matchNote
    });

    let lastRun;
    try {
        const execResult = await useCase.execute(domains);
        lastRun = ddnsLastRunRecordFromExecResult(execResult);
    } catch (err) {
        lastRun = ddnsLastRunRecordFromError(err);
        if (typeof persistence.saveDdnsLastRunForJob === "function") {
            persistence.saveDdnsLastRunForJob(job.id, lastRun);
        } else if (typeof persistence.saveDdnsLastRun === "function") {
            persistence.saveDdnsLastRun(lastRun);
        }
        throw err;
    }

    if (typeof persistence.saveDdnsLastRunForJob === "function") {
        persistence.saveDdnsLastRunForJob(job.id, lastRun);
    } else if (typeof persistence.saveDdnsLastRun === "function") {
        persistence.saveDdnsLastRun(lastRun);
    }

    return { lastRun, jobId: job.id };
}

/**
 * @param {{ persistence: { getDdnsSettings?: () => object | null, getDatabaseSync: () => import("node:sqlite").DatabaseSync, saveDdnsLastRunForJob?: (jobId: string, r: object) => void, saveDdnsLastRun?: (r: object) => void }, getApexDomains?: () => string[], getDnsConsoleContext?: () => { dnsConsole?: object | null, env?: object } | null | undefined, logger: object }} ctx
 * @param {{ force?: boolean, jobId?: string }} [options]
 * @returns {Promise<{ ran: true, ranJobIds: string[] } | { ran: false, reason?: string }>}
 */
export async function runDdnsSyncCycle(ctx, options = {}) {
    const { persistence, logger, getApexDomains, getDnsConsoleContext } = ctx;
    const force = Boolean(options.force);
    const onlyJobId = options.jobId != null ? String(options.jobId).trim() : "";

    const stored = typeof persistence.getDdnsSettings === "function" ? persistence.getDdnsSettings() : null;
    const parsed = normalizeStoredDdns(stored);
    if (!parsed.ok) {
        return { ran: false, reason: "invalid_stored_ddns" };
    }

    const resolveSnap = snapshotDdnsResolveContext(getApexDomains, getDnsConsoleContext);

    /** @type {Array<{ jobId: string, job: object, domains: string[], matchNote: string, ipLookupTimeoutMs: number, ipv4Services: string[], ipv6Services: string[] }>} */
    let entries = [];

    if (onlyJobId) {
        const job = parsed.value.jobs.find(j => j.id === onlyJobId);
        if (!job) {
            return { ran: false, reason: "ddns_job_not_found" };
        }
        const { domains } = resolveDomainsForJob(job, resolveSnap.getApexDomains, resolveSnap.getDnsConsoleContext);
        let credOk = false;
        if (job.provider === "porkbun") {
            const c = job.credentials || {};
            credOk = !!(c.porkbunApiKey && c.porkbunSecretKey);
        } else if (job.provider === "namecheap") {
            const c = job.credentials || {};
            credOk = !!(c.apiUser && c.apiKey && c.clientIp);
        }
        if (!job.enabled || !credOk || domains.length === 0) {
            return { ran: false, reason: "ddns_job_not_runnable" };
        }
        entries = [
            {
                jobId: job.id,
                job,
                domains,
                matchNote: job.matchNote,
                ipLookupTimeoutMs: job.ipLookupTimeoutMs,
                ipv4Services: job.ipv4Services,
                ipv6Services: job.ipv6Services
            }
        ];
    } else if (force) {
        for (const job of parsed.value.jobs) {
            const { domains } = resolveDomainsForJob(job, resolveSnap.getApexDomains, resolveSnap.getDnsConsoleContext);
            let credOk = false;
            if (job.provider === "porkbun") {
                const c = job.credentials || {};
                credOk = !!(c.porkbunApiKey && c.porkbunSecretKey);
            } else if (job.provider === "namecheap") {
                const c = job.credentials || {};
                credOk = !!(c.apiUser && c.apiKey && c.clientIp);
            }
            if (!job.enabled || !credOk || domains.length === 0) continue;
            entries.push({
                jobId: job.id,
                job,
                domains,
                matchNote: job.matchNote,
                ipLookupTimeoutMs: job.ipLookupTimeoutMs,
                ipv4Services: job.ipv4Services,
                ipv6Services: job.ipv6Services
            });
        }
    } else {
        const plan = getDdnsSchedulerPlan(ctx, Date.now());
        entries = plan.dueJobs;
    }

    if (entries.length === 0) {
        return { ran: false, reason: force ? "ddns_no_runnable_jobs" : "ddns_no_due_jobs" };
    }

    const ranJobIds = [];
    for (const dueEntry of entries) {
        try {
            await runDdnsJob({
                persistence,
                logger,
                dueEntry: {
                    jobId: dueEntry.jobId,
                    job: dueEntry.job,
                    domains: dueEntry.domains,
                    matchNote: dueEntry.matchNote,
                    ipLookupTimeoutMs: dueEntry.ipLookupTimeoutMs,
                    ipv4Services: dueEntry.ipv4Services,
                    ipv6Services: dueEntry.ipv6Services
                }
            });
            ranJobIds.push(dueEntry.jobId);
        } catch (err) {
            logger.error({ event: "ddns_job_error", jobId: dueEntry.jobId, err: err.message }, "DDNS job failed");
            if (force || onlyJobId) {
                throw err;
            }
        }
    }

    if (ranJobIds.length === 0) {
        return { ran: false, reason: "ddns_all_jobs_failed" };
    }

    return { ran: true, ranJobIds };
}

/**
 * Runs one full manual sync cycle (all enabled jobs), same as POST /api/v1/ddns/sync without jobId.
 *
 * @param {{ persistence: object, getApexDomains?: () => string[], getDnsConsoleContext?: () => object | null | undefined, logger: object }} ctx
 */
export async function runDdnsSyncOnce(ctx) {
    return runDdnsSyncCycle(ctx, { force: true });
}
