export class ServiceRegistry {
  constructor(ttlMs = 30_000) {
    this.services = new Map()
    this.ttlMs = ttlMs
  }

  register(host, { port, healthCheckUrl, heartbeat = true }) {
    const key = host.toLowerCase()
    const existing = this.services.get(key)
    if (existing) {
      if (existing.heartbeat === false) {
        return { success: false, reason: 'permaclaim' }
      }
      if (!this._isStale(existing)) {
        return { success: false, reason: 'active' }
      }
    }

    this.services.set(key, {
      host: key,
      port,
      healthCheckUrl,
      heartbeat,
      lastHeartbeat: heartbeat ? Date.now() : null,
    })
    return { success: true }
  }

  _isStale(service) {
    if (service.heartbeat === false) return false
    return Date.now() - service.lastHeartbeat > this.ttlMs
  }

  heartbeat(host) {
    const service = this.services.get(host.toLowerCase())
    if (!service) return false
    service.lastHeartbeat = Date.now()
    return true
  }

  deregister(host) {
    return this.services.delete(host.toLowerCase())
  }

  getServices() {
    const result = {}
    for (const [key, service] of this.services) {
      result[key] = {
        host: service.host,
        port: service.port,
        healthCheckUrl: service.healthCheckUrl,
        heartbeat: service.heartbeat,
        lastHeartbeat: service.lastHeartbeat,
      }
    }
    return result
  }

  isStale(host) {
    const service = this.services.get(host.toLowerCase())
    if (!service) return false
    return this._isStale(service)
  }

  get(host) {
    return this.services.get(host.toLowerCase()) || null
  }

  *findServicesWithHealthCheck() {
    for (const service of this.services.values()) {
      if (service.healthCheckUrl) {
        yield service
      }
    }
  }

  *findStaleServices() {
    for (const [, service] of this.services) {
      if (this._isStale(service)) {
        yield service.host
      }
    }
  }
}
