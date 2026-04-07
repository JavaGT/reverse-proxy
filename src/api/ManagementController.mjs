import { generateSecret, writeSecretFile } from "../shared/utils/SecretUtils.mjs";

/**
 * SRP: Contains the business logic for management API routes.
 * RESTful: Supports HA with multi-target reservation and secure secret rotation.
 */
export class ManagementController {
    #registry;
    #persistence;
    #logger;
    #secretFile;

    constructor(registry, persistence, logger, secretFile = null) {
        this.#registry = registry;
        this.#persistence = persistence;
        this.#logger = logger;
        this.#secretFile = secretFile;
    }

    get registry() {
        return this.#registry;
    }

    async getRoutes(req, res) {
        this.#logger.info({ event: "mgmt_get_routes" }, "Listing all routes");
        res.status(200).json({ data: this.#registry.getAllRoutes() });
    }

    async reserve(req, res) {
        try {
            const { subdomain, port, ports, targets, target, options } = req.body;
            
            let reservationTargets = targets;
            if (!reservationTargets) {
              if (ports) {
                reservationTargets = ports; 
              } else if (port) {
                reservationTargets = [port];
              } else if (target) {
                reservationTargets = [target];
              }
            }

            if (!reservationTargets || (Array.isArray(reservationTargets) && reservationTargets.length === 0)) {
               return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Targets, ports, or target is required" } });
            }

            let result;
            if (typeof reservationTargets[0] === "number") {
                result = this.#registry.reserve(subdomain, reservationTargets, options);
            } else {
                const host = `${subdomain.trim().toLowerCase()}.${this.#registry.rootDomain}`;
                result = this.#registry.registerPersistentRoute(host, reservationTargets, options);
            }
            
            this.#logger.info({ event: "mgmt_reserve", host: result.host }, `Reserved ${result.host} with ${result.targets.length} target(s)`);
            await this.#persistence.save(this.#registry.getPersistentRoutes());
            
            res.status(201).json({ data: result });
        } catch (error) {
            this.#logger.error({ event: "mgmt_reserve_error", error: error.message }, "Reservation failed");
            res.status(400).json({ 
                error: { 
                    code: "RESERVATION_FAILED", 
                    message: error.message 
                } 
            });
        }
    }

    async release(req, res) {
        try {
            const { subdomain } = req.params;
            const result = this.#registry.release(subdomain);
            
            if (!result) {
                return res.status(404).json({ 
                    error: { 
                        code: "ROUTE_NOT_FOUND", 
                        message: "Route not found" 
                    } 
                });
            }

            this.#logger.info({ event: "mgmt_release", host: result.host }, `Released ${result.host}`);
            await this.#persistence.save(this.#registry.getPersistentRoutes());
            
            res.status(200).json({ data: result });
        } catch (error) {
            this.#logger.error({ event: "mgmt_release_error", error: error.message }, "Release failed");
            res.status(400).json({ 
                error: { 
                    code: "RELEASE_FAILED", 
                    message: error.message 
                } 
            });
        }
    }

    async rotateSecret(req, res) {
        if (!this.#secretFile) {
            return res.status(400).json({ error: { code: "CONFIGURATION_ERROR", message: "No secret file configured to rotate" } });
        }

        try {
            const newSecret = generateSecret();
            writeSecretFile(this.#secretFile, newSecret);
            
            this.#logger.warn({ event: "mgmt_secret_rotated" }, "Management secret rotated via API");
            
            res.status(200).json({ 
                data: { 
                    message: "Secret rotated successfully", 
                    newSecret 
                } 
            });
        } catch (error) {
            this.#logger.error({ event: "mgmt_rotate_error", error: error.message }, "Secret rotation failed");
            res.status(500).json({ error: { code: "ROTATION_FAILED", message: error.message } });
        }
    }

    getHealth(req, res) {
        res.status(200).json({ data: { status: "OK" } });
    }

    getIndex(req, res) {
        res.status(200).json({ 
            data: { 
                message: "Reverse proxy management interface. Use GET /api/v1/routes to list registered routes." 
            } 
        });
    }
}
