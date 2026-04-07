import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";

/**
 * SRP: Manages TLS certificates and secure context.
 * Encapsulated: Uses private class fields and methods.
 */
export class TlsService {
    #certDir;
    #logger;
    #secureContext = null;
    #certReloadTimer = null;

    constructor(certDir, logger) {
        this.#certDir = certDir;
        this.#logger = logger;
    }

    get secureContext() {
        return this.#secureContext;
    }

    /** Loads initial certificates and starts periodic reload. */
    async start() {
        this.reloadContext();
        
        // Reload every hour to catch Renewals automatically
        this.#certReloadTimer = setInterval(() => {
            this.reloadContext();
        }, 3600 * 1000);
    }

    stop() {
        if (this.#certReloadTimer) {
            clearInterval(this.#certReloadTimer);
            this.#certReloadTimer = null;
        }
    }

    /** Reloads the TLS context from disk. */
    reloadContext() {
        try {
            const keyPath = path.join(this.#certDir, "privkey.pem");
            const certPath = path.join(this.#certDir, "fullchain.pem");

            if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
                throw new Error(`Certs missing in ${this.#certDir}`);
            }

            const key = fs.readFileSync(keyPath);
            const cert = fs.readFileSync(certPath);

            this.#secureContext = tls.createSecureContext({ key, cert }).context;
            this.#logger.info({ event: "tls_context_reloaded" }, "TLS context reloaded successfully");
        } catch (err) {
            this.#logger.error({ event: "tls_reload_error", error: err.message }, "Failed to reload TLS context");
            if (!this.#secureContext) throw err;
        }
    }
}
