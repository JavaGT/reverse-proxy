import { config } from './config.js'
import { ServiceRegistry } from './registry/store.js'
import { startCleanupTask } from './registry/cleanup.js'
import { startHealthCheckTask } from './healthcheck.js'
import { buildServer, buildHttpsServer } from './server.js'
import { ensureCertificate, startRenewalTask } from './tls.js'

const registry = new ServiceRegistry(config.ttlMs)

const stopCleanup = startCleanupTask(
  registry,
  config.cleanupIntervalMs,
  { info: (msg) => console.log(msg) }
)

const stopHealthChecks = startHealthCheckTask(
  registry,
  config.healthCheckIntervalMs,
  { info: (msg) => console.log(msg) }
)

let stopRenewal = () => {}
const servers = []

const shutdown = async () => {
  console.log('Shutting down...')
  stopCleanup()
  stopHealthChecks()
  stopRenewal()
  await Promise.all(servers.map(s => s.close()))
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

const start = async () => {
  const httpServer = buildServer(registry)
  servers.push(httpServer)

  try {
    await httpServer.listen({ port: config.port, host: config.host })
    console.log(`HTTP server running on ${config.host}:${config.port}`)
  } catch (err) {
    httpServer.log.error(err)
    process.exit(1)
  }

  if (config.acme) {
    try {
      const tls = await ensureCertificate(config.acme)
      const httpsServer = buildHttpsServer(registry, tls)
      servers.push(httpsServer)

      await httpsServer.listen({ port: config.httpsPort, host: config.host })
      console.log(`HTTPS server running on ${config.host}:${config.httpsPort}`)

      stopRenewal = startRenewalTask(
        () => ensureCertificate(config.acme),
        ({ key, cert }) => {
          try {
            httpsServer.server.setSecureContext({ key, cert })
            console.log('TLS context updated with renewed certificate')
          } catch (err) {
            console.error('Failed to update TLS context:', err.message)
          }
        }
      )
    } catch (err) {
      console.error('Failed to set up HTTPS:', err.message)
      console.log('Continuing with HTTP only')
    }
  }
}

export { start }

const isMain = process.argv[1] && (
  process.argv[1].includes('/src/index.js') ||
  process.argv[1].includes('\\src\\index.js')
)
if (isMain) start()
