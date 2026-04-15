import { PorkbunDnsProvider } from "./porkbun/PorkbunDnsProvider.mjs";
import { NamecheapDnsProvider } from "./namecheap/NamecheapDnsProvider.mjs";

/**
 * @param {object} job - Normalized DDNS job from {@link ../ddnsConfigResolve.mjs}
 * @param {object} logger
 */
export function createDnsProviderForJob(job, logger) {
    if (job.provider === "porkbun") {
        const c = job.credentials || {};
        return new PorkbunDnsProvider({
            apiKey: c.porkbunApiKey,
            secretKey: c.porkbunSecretKey,
            apiBaseUrl: c.porkbunApiBaseUrl,
            logger
        });
    }
    if (job.provider === "namecheap") {
        return new NamecheapDnsProvider({ job, logger });
    }
    throw new Error(`Unknown DDNS provider: ${job.provider}`);
}
