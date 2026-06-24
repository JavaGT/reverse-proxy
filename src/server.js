import http from 'http'
import http2 from 'http2'
import { performance, PerformanceObserver } from 'perf_hooks'
import { challenges } from './tls.js'
import { apiKeyAuth } from './middleware/auth.js'
import { registerHandler } from './routes/register.js'
import { heartbeatHandler } from './routes/heartbeat.js'
import { deregisterHandler } from './routes/deregister.js'
import { servicesHandler } from './routes/services.js'
import { forwardHttpProxy, forwardWebSocket } from './routes/proxy.js'
import { createReply } from './http/reply.js'
import { readJsonBody } from './http/body.js'
import { getRequestHost } from './utils/host.js'

function wrapRequest(req, body, registry) {
  return {
    headers: req.headers,
    body,
    url: req.url,
    method: req.method,
    server: { registry },
  }
}

function handleAcme(pathname, res) {
  const m = pathname.match(/^\/\.well-known\/acme-challenge\/([^/]+)\/?$/)
  if (!m) return false
  const token = m[1]
  const keyAuth = challenges.get(token)
  const reply = createReply(res)
  if (!keyAuth) reply.code(404).send('Not found')
  else reply.type('text/plain').send(keyAuth)
  return true
}

export function createRequestListener(registry) {
  return async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname

    try {
      if (handleAcme(pathname, res)) return

      if (req.method === 'GET' && pathname === '/ping') {
        const payload = Buffer.from('pong')
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Length': payload.length
        })
        res.end(payload)
        return
      }

      if (req.method === 'POST' && pathname === '/register') {
        const body = await readJsonBody(req)
        if (body.__parseError) {
          createReply(res).code(400).send({ error: 'Invalid JSON' })
          return
        }
        const request = wrapRequest(req, body, registry)
        const reply = createReply(res)
        await apiKeyAuth(request, reply)
        if (reply.isSent()) return
        await registerHandler(request, reply)
        return
      }

      if (req.method === 'POST' && pathname === '/heartbeat') {
        const body = await readJsonBody(req)
        if (body.__parseError) {
          createReply(res).code(400).send({ error: 'Invalid JSON' })
          return
        }
        const request = wrapRequest(req, body, registry)
        const reply = createReply(res)
        await apiKeyAuth(request, reply)
        if (reply.isSent()) return
        await heartbeatHandler(request, reply)
        return
      }

      if (req.method === 'DELETE' && pathname === '/deregister') {
        const body = await readJsonBody(req)
        if (body.__parseError) {
          createReply(res).code(400).send({ error: 'Invalid JSON' })
          return
        }
        const request = wrapRequest(req, body, registry)
        const reply = createReply(res)
        await apiKeyAuth(request, reply)
        if (reply.isSent()) return
        await deregisterHandler(request, reply)
        return
      }

      if (req.method === 'GET' && pathname === '/services') {
        const request = wrapRequest(req, {}, registry)
        const reply = createReply(res)
        await apiKeyAuth(request, reply)
        if (reply.isSent()) return
        await servicesHandler(request, reply)
        return
      }

      const host = getRequestHost(req)
      if (!host) {
        createReply(res).code(400).send({ error: 'Missing Host or HTTP/2 :authority' })
        return
      }
      const service = registry.get(host.toLowerCase())
      if (!service) {
        createReply(res).code(502).send({ error: 'Service not found' })
        return
      }
      await forwardHttpProxy(req, res, service, host)
    } catch (err) {
      if (!res.headersSent) {
        const payload = Buffer.from(JSON.stringify({ error: err.message || 'Internal error' }))
        res.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': payload.length
        })
        res.end(payload)
      }
    }
  }
}

export function createUpgradeListener(registry) {
  return (req, socket, head) => {
    const host = getRequestHost(req)
    if (!host) {
      socket.destroy()
      return
    }
    const service = registry.get(host.toLowerCase())
    if (!service) {
      socket.destroy()
      return
    }
    forwardWebSocket(req, socket, head, service, host)
  }
}

function wrapServer(server) {
  return {
    server,
    listen(opts) {
      const { port, host } = opts
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host ?? '::', () => {
          server.removeListener('error', reject)
          resolve()
        })
      })
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
    async inject({ method, url, headers = {}, payload }) {
      const addr = server.address()
      if (!addr || typeof addr !== 'object') {
        throw new Error('buildServer().listen() must be called before inject()')
      }
      const port = addr.port
      const body = payload !== undefined ? JSON.stringify(payload) : undefined
      const res = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
      })
      const text = await res.text()
      return {
        statusCode: res.status,
        body: text,
        json() {
          return JSON.parse(text)
        },
      }
    },
  }
}

export function buildServer(registry) {
  const listener = createRequestListener(registry)
  const onUpgrade = createUpgradeListener(registry)
  const server = http.createServer(listener)
  server.on('upgrade', onUpgrade)
  return wrapServer(server)
}

// ── H2 session management ──────────────────────────────────────────────
// Tracks request count per session to rotate long-lived connections before
// they degrade. Safari H2 sessions that stay open for hours accumulate
// packet loss, stale TCP state, and prioritization drift, causing page
// loads to get slower over time.
const sessionCounts = new WeakMap()
const MAX_REQUESTS_PER_SESSION = 2000
const SESSION_IDLE_MS = 600_000
const GOAWAY_GRACE_MS = 10_000

// ── Event loop lag monitor ─────────────────────────────────────────────
// Even small event loop pauses (<50ms) create visible H2 latency spikes
// because many streams share one TCP connection. Log when lag exceeds
// threshold so we can correlate stalls with proxy-side blocking.
let eventLoopMonitor = null
function startEventLoopMonitor() {
  try {
    const histogram = performance.monitorEventLoopDelay({ resolution: 20 })
    histogram.enable()
    const check = setInterval(() => {
      const p95 = histogram.percentile(95)
      const p99 = histogram.percentile(99)
      if (p99 > 100_000_000) { // 100ms in nanoseconds
        console.warn(`[proxy] event loop lag: p95=${(p95/1e6).toFixed(1)}ms p99=${(p99/1e6).toFixed(1)}ms`)
      }
      histogram.reset()
    }, 30_000)
    // Don't prevent process exit
    if (check.unref) check.unref()
    return () => { clearInterval(check); histogram.disable() }
  } catch {
    // monitorEventLoopDelay may not be available (requires --experimental-permissions off)
    return () => {}
  }
}

export function buildHttpsServer(registry, tls) {
  const stopMonitor = startEventLoopMonitor()
  const listener = createRequestListener(registry)
  const onUpgrade = createUpgradeListener(registry)

  const server = http2.createSecureServer({
    allowHTTP1: true,
    ...tls,
    maxSessionMemory: 16,               // prevent memory growth from stale sessions
    maxDeflateDynamicTableSize: 4096,   // bounded HPACK table
    settings: {
      maxConcurrentStreams: 100,        // prevent stream starvation
      initialWindowSize: 65535,         // default 64KB — sufficient for scope assets
    },
  }, (req, res) => {
    // Rotate long-lived H2 sessions before they degrade.
    if (req.stream && req.stream.session) {
      const session = req.stream.session
      const prev = sessionCounts.get(session) || 0
      const next = prev + 1
      sessionCounts.set(session, next)
      if (next >= MAX_REQUESTS_PER_SESSION) {
        // Send GOAWAY — browser creates a fresh connection for next request.
        // The grace period lets in-flight requests finish without RST_STREAM.
        session.goaway(http2.constants.NGHTTP2_NO_ERROR, GOAWAY_GRACE_MS)
        // Wipe counter so we only GOAWAY once (goaway on an already-going-away session is a no-op)
        sessionCounts.set(session, -1)
      }
    }
    listener(req, res)
  })

  server.on('upgrade', onUpgrade)

  // TCP keepalive detects stale connections. Without this, a proxy-side
  // socket drop can go unnoticed by Safari for ~13s (its internal H2
  // recovery timeout), causing the "parser idle" waterfall gap.
  server.on('connection', (socket) => socket.setKeepAlive(true, 10000))

  // Idle session timeout — gracefully rotate sessions that have been idle
  // too long instead of keeping them forever (the Node.js default is 0/infinite).
  // Long-lived H2 sessions accumulate packet loss and prioritization drift.
  server.on('session', (session) => {
    session.setTimeout(SESSION_IDLE_MS, () => {
      session.goaway(http2.constants.NGHTTP2_NO_ERROR)
    })
  })

  const wrapped = wrapServer(server)
  const origClose = wrapped.close
  wrapped.close = () => {
    stopMonitor()
    return origClose()
  }
  return wrapped
}
