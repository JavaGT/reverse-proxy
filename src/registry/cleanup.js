export function startCleanupTask(registry, intervalMs, logger) {
  const interval = setInterval(() => {
    let removed = 0
    for (const host of registry.findStaleServices()) {
      if (registry.isStale(host)) {
        registry.deregister(host)
        removed++
      }
    }
    if (removed > 0 && logger) {
      logger.info(`Removed ${removed} stale services`)
    }
  }, intervalMs)

  return () => clearInterval(interval)
}
