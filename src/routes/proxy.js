import http from 'http'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const http2Proxy = require('http2-proxy')

// Upstream agent: no keepAlive so idle sockets can't go stale.
// When keepAlive is enabled and the backend closes an idle connection (via
// keepAliveTimeout), the socket goes CLOSE_WAIT in the free pool. The agent
// doesn't detect this, hands it to the next request, the write buffers in
// the kernel, and no response ever comes — hanging the stream forever.
// Without keepAlive each request gets a fresh TCP connection (handshake
// on localhost is ~0.1ms). 64 concurrent sockets prevents queuing.
const upstreamAgent = new http.Agent({
  keepAlive: false,
  maxSockets: 64,
})

export function destroyProxyAgent() {
  upstreamAgent.destroy()
}

const STRIP_HEADERS = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'host', 'etag',
  ':method', ':path', ':scheme', ':authority',
])

function cleanHeaders(headers) {
  const result = {}
  for (const [k, v] of Object.entries(headers || {})) {
    if (!STRIP_HEADERS.has(k.toLowerCase())) result[k] = v
  }
  return result
}

/**
 * Stream request/response to upstream via native http.request.
 * Replaces http2-proxy which has a socket.localAddress crash in v5.0.53.
 *
 * Key correctness rules:
 *  - 304/204/HEAD responses have no body: call res.end() immediately so the
 *    HTTP/2 END_STREAM flag is sent. Without this the browser hangs in
 *    "receive" for the full keep-alive timeout (~8s), stalling every other
 *    H2 stream on the connection behind it.
 *  - For normal responses, pipe with { end: false } and call res.end()
 *    explicitly on 'end'/'error' so END_STREAM is always sent even if the
 *    upstream socket closes unexpectedly.
 */
export function forwardHttpProxy(req, res, service, originalHost) {
  return new Promise((resolve) => {
    const opts = {
      agent: upstreamAgent,
      hostname: '127.0.0.1',
      port: service.port,
      path: req.url,
      method: req.method,
      headers: {
        ...cleanHeaders(req.headers),
        'x-forwarded-host': originalHost,
        'accept-encoding': 'gzip, deflate, br',
      },
    }

    const upstreamReq = http.request(opts, (upstreamRes) => {
      const { statusCode } = upstreamRes
      const respHeaders = cleanHeaders(upstreamRes.headers)

      // 304 Not Modified, 204 No Content, and HEAD responses carry no body.
      // End the H2 (or HTTP/1.1) response immediately so END_STREAM is sent
      // right away, unblocking all other streams on this connection.
      const noBody =
        statusCode === 304 ||
        statusCode === 204 ||
        req.method === 'HEAD'

      if (noBody) {
        respHeaders['content-length'] = '0'
        res.writeHead(statusCode, respHeaders)
        res.end()
        resolve()
        upstreamRes.resume() // drain so the upstream socket is returned to pool
        return
      }

      // Buffer up to 4KB to capture the HTML <head> so we can send headers early
      // (giving the browser a head start on sub-resource discovery) while still
      // computing Content-Length for small responses to avoid Safari H2 stalls.
      const MAX_BUFFER = 4096
      let buffer = []
      let bufferSize = 0
      let isStreaming = false

      const onDrain = () => upstreamRes.resume()
      res.on('drain', onDrain)

      upstreamRes.on('data', (chunk) => {
        if (isStreaming) {
          const ok = res.write(chunk)
          if (!ok) upstreamRes.pause()
          return
        }

        buffer.push(chunk)
        bufferSize += chunk.length

        if (bufferSize > MAX_BUFFER) {
          isStreaming = true
          res.writeHead(statusCode, respHeaders) // Send headers without Content-Length
          const bigChunk = Buffer.concat(buffer)
          buffer = null
          const ok = res.write(bigChunk)
          if (!ok) upstreamRes.pause()
        }
      })

      upstreamRes.once('end', () => {
        res.removeListener('drain', onDrain)
        if (!isStreaming && buffer !== null) {
          const completeBody = Buffer.concat(buffer)
          respHeaders['content-length'] = completeBody.length.toString()
          res.writeHead(statusCode, respHeaders)
          res.end(completeBody)
        } else {
          res.end()
        }
        resolve()
      })

      upstreamRes.once('error', (err) => {
        console.error(`[proxy] upstream body error:`, err.message)
        res.removeListener('drain', onDrain)
        if (!isStreaming && buffer !== null) {
          res.writeHead(statusCode, respHeaders)
          res.write(Buffer.concat(buffer))
        }
        res.end()
        resolve()
      })
    })

    upstreamReq.on('error', (err) => {
      console.error(`[proxy] forward error:`, err.message)
      if (!res.headersSent) {
        const payload = Buffer.from(JSON.stringify({ error: 'Bad Gateway', detail: err.message }))
        res.writeHead(502, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': payload.length
        })
        res.end(payload)
      } else {
        res.end()
      }
      resolve()
    })

    // Safety timeout: if the upstream doesn't respond within 30s, abort.
    // Prevents the deadlock where all 64 agent sockets are consumed by
    // requests that are waiting on CLOSE_WAIT connections.
    upstreamReq.setTimeout(30_000, () => {
      upstreamReq.destroy(new Error('Upstream timeout'))
    })

    req.pipe(upstreamReq)
  })
}

export function forwardWebSocket(req, socket, head, service, originalHost) {
  return http2Proxy.ws(req, socket, head, {
    hostname: '127.0.0.1',
    port: service.port,
  }).catch(() => {
    if (!socket.destroyed) socket.destroy()
  })
}
