import http from 'http'

export class ReverseProxySDK {
  constructor({ proxyUrl, host, subdomain, port, apiKey, healthCheckUrl, heartbeatIntervalMs = 10_000 }) {
    this.proxyUrl = proxyUrl
    this.host = host || subdomain
    this.subdomain = subdomain
    this.port = port
    this.apiKey = apiKey
    this.healthCheckUrl = healthCheckUrl
    this.heartbeatIntervalMs = heartbeatIntervalMs
    this.heartbeatTimer = null
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

  async register() {
    try {
      const body = { host: this.host, port: this.port, heartbeat: true }
      if (this.healthCheckUrl) body.healthCheckUrl = this.healthCheckUrl
      await this._request('POST', '/register', body)
      this.emit('onRegisterSuccess', { host: this.host })
      this._startHeartbeat()
      return true
    } catch (err) {
      this.emit('onError', { action: 'register', error: err })
      throw err
    }
  }

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this._request('POST', '/heartbeat', { host: this.host })
      } catch (err) {
        this.emit('onError', { action: 'heartbeat', error: err })
      }
    }, this.heartbeatIntervalMs)
  }

  async deregister() {
    try {
      clearInterval(this.heartbeatTimer)
      await this._request('DELETE', '/deregister', { host: this.host })
      this.emit('onDeregistered', { host: this.host })
      return true
    } catch (err) {
      this.emit('onError', { action: 'deregister', error: err })
      throw err
    }
  }
}
