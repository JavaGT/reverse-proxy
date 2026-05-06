import 'dotenv/config'

export const config = {
  apiKey: process.env.PROXY_API_KEY || 'dev-secret-change-me',
  port: Number(process.env.PROXY_PORT) || 9080,
  host: process.env.PROXY_HOST || 'localhost',
  httpsPort: Number(process.env.PROXY_HTTPS_PORT) || 9443,
  ttlMs: Number(process.env.TTL_MS) || 30_000,
  cleanupIntervalMs: Number(process.env.CLEANUP_INTERVAL_MS) || 5_000,
  healthCheckIntervalMs: Number(process.env.HEALTH_CHECK_INTERVAL_MS) || 15_000,
  acme: process.env.PROXY_ACME_EMAIL && process.env.PROXY_ACME_DOMAINS
    ? {
        email: process.env.PROXY_ACME_EMAIL,
        domains: process.env.PROXY_ACME_DOMAINS.split(',').map(d => d.trim()),
        staging: process.env.PROXY_ACME_STAGING === 'true',
        porkbunKey: process.env.PORKBUN_API_KEY || null,
        porkbunSecret: process.env.PORKBUN_SECRET_KEY || null,
      }
    : null,
}
