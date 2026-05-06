import http from 'http'

export function startHealthCheckTask(registry, intervalMs, logger) {
  const interval = setInterval(() => {
    for (const service of registry.findServicesWithHealthCheck()) {
      const url = service.healthCheckUrl.startsWith('http')
        ? service.healthCheckUrl
        : `http://127.0.0.1:${service.port}${service.healthCheckUrl.startsWith('/') ? '' : '/'}${service.healthCheckUrl}`
      const req = http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          service.lastHeartbeat = Date.now()
        } else {
          logger?.info(`Health check failed for ${service.host}: HTTP ${res.statusCode}`)
        }
        res.resume()
      })

      req.on('error', (err) => {
        logger?.info(`Health check error for ${service.host}: ${err.message}`)
      })

      req.setTimeout(5000, () => {
        req.destroy()
        logger?.info(`Health check timeout for ${service.host}`)
      })
    }
  }, intervalMs)

  return () => clearInterval(interval)
}

