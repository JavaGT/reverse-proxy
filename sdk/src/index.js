import http from 'http'

/**
 * Client for registering a backend with the reverse-proxy control plane.
 *
 * By default this class does **not** attach `process` signal listeners or call
 * `process.exit` — safe for use inside long-lived apps and test runners. For
 * one-shot CLI-style scripts, call {@link ReverseProxySDK#registerShutdownHooks}
 * after {@link ReverseProxySDK#register} (or whenever you want signals handled).
 */
export class ReverseProxySDK {
  /**
   * @param {object} opts
   * @param {string} opts.proxyUrl - Base URL of the proxy (e.g. `http://proxy:9080`).
   * @param {string} [opts.host] - Hostname to register (preferred over `subdomain`).
   * @param {string} [opts.subdomain] - Legacy alias used as `host` when `host` is omitted.
   * @param {number} opts.port - Local port the proxy should forward to.
   * @param {string} opts.apiKey - `x-api-key` for control-plane routes.
   * @param {string} [opts.healthCheckUrl] - Optional health check URL stored with the service.
   * @param {number} [opts.heartbeatIntervalMs=10000] - Heartbeat interval in ms.
   */
  constructor({ proxyUrl, host, subdomain, port, apiKey, healthCheckUrl, heartbeatIntervalMs = 10_000 }) {
    this.proxyUrl = proxyUrl
    this.host = host || subdomain
    this.subdomain = subdomain
    this.port = port
    this.apiKey = apiKey
    this.healthCheckUrl = healthCheckUrl
    this.heartbeatIntervalMs = heartbeatIntervalMs
    this.heartbeatTimer = null
    this.registered = false
    this._reconnecting = false
    this._stopped = false
    this._shutdownHandlersSet = false
    /** @type {(() => Promise<void>) | null} */
    this._shutdownHook = null
    this._shutdownHookRunning = false
    this.events = {
      onRegisterSuccess: [],
      onDeregistered: [],
      onError: [],
    }
  }

  on(event, callback) {
    if (this.events[event]) {
      this.events[event].push(callback)
    }
    return this
  }

  emit(event, ...args) {
    if (this.events[event]) {
      for (const cb of this.events[event]) {
        try {
          cb(...args)
        } catch (err) {
          console.error(`Error in ${event} handler:`, err)
        }
      }
    }
  }

  async _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.proxyUrl)
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
      }

      const req = http.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => data += chunk)
        res.on('end', () => {
          if (res.statusCode >= 400) {
            const err = new Error(`HTTP ${res.statusCode}: ${data}`)
            err.statusCode = res.statusCode
            reject(err)
          } else {
            try {
              resolve(JSON.parse(data))
            } catch {
              resolve(data)
            }
          }
        })
      })

      req.on('error', reject)
      if (body) req.write(JSON.stringify(body))
      req.end()
    })
  }

  async _registerWithRetry() {
    let delay = 1000
    const maxDelay = 30_000

    while (!this._stopped) {
      try {
        const body = { host: this.host, port: this.port, heartbeat: true }
        if (this.healthCheckUrl) body.healthCheckUrl = this.healthCheckUrl
        await this._request('POST', '/register', body)
        this.registered = true
        this.emit('onRegisterSuccess', { host: this.host })
        return
      } catch (err) {
        this.emit('onError', { action: 'register', error: err, retrying: true })
        await new Promise(r => setTimeout(r, delay))
        delay = Math.min(delay * 2, maxDelay)
      }
    }
  }

  /**
   * Registers with the proxy and starts the heartbeat timer. Does not install
   * OS signal handlers; use {@link ReverseProxySDK#registerShutdownHooks} when
   * you want SIGINT/SIGTERM to deregister and exit.
   */
  async register() {
    await this._registerWithRetry()
    this._startHeartbeat()
    return true
  }

  /**
   * Attach SIGINT/SIGTERM handlers that stop the client and optionally deregister,
   * then call `process.exit`. Call this explicitly for script-style processes;
   * omit it in libraries and servers where owning `process` is inappropriate.
   *
   * Idempotent for this instance: second and later calls are no-ops.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.deregister=true] - If true, await {@link ReverseProxySDK#deregister}
   *   before exiting. On failure, {@link ReverseProxySDK#deregister} emits `onError`
   *   then throws; the process still exits with `exitCode` (same as prior best-effort behavior).
   * @param {number} [opts.exitCode=0] - Code passed to `process.exit`.
   * @returns {this}
   */
  registerShutdownHooks({ deregister = true, exitCode = 0 } = {}) {
    if (this._shutdownHandlersSet) return this
    this._shutdownHandlersSet = true

    this._shutdownHook = async () => {
      if (this._shutdownHookRunning) return
      this._shutdownHookRunning = true
      this._stopped = true
      if (deregister) {
        try {
          await this.deregister()
        } catch {
          // `deregister` already emitted `onError`; still exit (script-style shutdown).
        }
      } else {
        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
        this.registered = false
        this._reconnecting = false
      }
      process.exit(exitCode)
    }

    process.on('SIGTERM', this._shutdownHook)
    process.on('SIGINT', this._shutdownHook)
    return this
  }

  _startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(async () => {
      if (this._reconnecting || this._stopped) return
      try {
        await this._request('POST', '/heartbeat', { host: this.host })
      } catch (err) {
        this.emit('onError', { action: 'heartbeat', error: err })
        this._reconnecting = true
        try {
          await this._registerWithRetry()
        } finally {
          this._reconnecting = false
        }
      }
    }, this.heartbeatIntervalMs)
  }

  async deregister() {
    this._stopped = true
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.registered = false
    this._reconnecting = false
    try {
      await this._request('DELETE', '/deregister', { host: this.host })
      this.emit('onDeregistered', { host: this.host })
      return true
    } catch (err) {
      this.emit('onError', { action: 'deregister', error: err })
      throw err
    }
  }
}
