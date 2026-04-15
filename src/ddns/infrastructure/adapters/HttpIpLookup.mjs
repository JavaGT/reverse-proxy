import { PublicIp } from "../../domain/models/PublicIp.mjs";

export class HttpIpLookup {
    constructor({ ipv4Services, ipv6Services, timeoutMs, logger }) {
        this.ipv4Services = ipv4Services;
        this.ipv6Services = ipv6Services;
        this.timeoutMs = timeoutMs;
        this.logger = logger;
    }

    async getPublicIps() {
        const [ipv4, ipv6] = await Promise.all([
            this.getPublicIpFromList(this.ipv4Services),
            this.getPublicIpFromList(this.ipv6Services)
        ]);
        return new PublicIp({ ipv4, ipv6 });
    }

    async getPublicIpFromList(urls) {
        for (const url of urls) {
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
                if (!response.ok) continue;

                const ip = (await response.text()).trim();
                if (ip.match(/[.:]/)) return ip;
            } catch {
                continue;
            }
        }
        return null;
    }
}
