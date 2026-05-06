import http from 'http'

export async function proxyHandler(request, reply) {
  const host = request.headers.host

  if (!host) {
    return reply.code(400).send({ error: 'Missing Host header' })
  }

  const service = request.server.registry.get(host)
  if (!service) {
    return reply.code(502).send({ error: 'Service not found' })
  }

  if (request.isWebSocket) {
    return handleWebSocket(request, reply, service)
  }

  return proxyHttp(request, reply, service)
}

async function proxyHttp(request, reply, service) {
  const originalHost = request.headers.host
  const isGet = request.method === 'GET' || request.method === 'HEAD'
  const options = {
    hostname: '127.0.0.1',
    port: service.port,
    path: request.url,
    method: request.method,
    headers: {
      ...request.headers,
      host: `127.0.0.1:${service.port}`,
      'x-forwarded-host': originalHost,
    },
  }

  return new Promise((resolve, reject) => {
    const proxyReq = http.request(options, (proxyRes) => {
      const hopByHop = ['transfer-encoding', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade']
      const headers = {}
      for (const [key, val] of Object.entries(proxyRes.headers)) {
        if (!hopByHop.includes(key)) headers[key] = val
      }
      reply.code(proxyRes.statusCode).headers(headers).send(proxyRes)
    })

    proxyReq.on('error', reject)

    if (isGet) {
      proxyReq.end()
    } else if (request.body) {
      const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
      proxyReq.write(raw)
      proxyReq.end()
    } else {
      proxyReq.end()
    }

    reply.raw.on('close', () => {
      proxyReq.destroy()
    })
  })
}

async function handleWebSocket(request, reply, service) {
  reply.hijack()
  const clientSocket = reply.raw.socket

  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: service.port,
    path: request.url,
    method: 'GET',
    headers: {
      ...request.headers,
      host: `127.0.0.1:${service.port}`,
      'x-forwarded-host': request.headers.host,
    },
  })

  proxyReq.on('upgrade', (proxyRes, proxySocket, head) => {
    if (head && head.length > 0) proxySocket.unshift(head)

    clientSocket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${proxyRes.headers['sec-websocket-accept']}\r\n` +
      '\r\n'
    )

    proxySocket.pipe(clientSocket)
    clientSocket.pipe(proxySocket)

    const cleanup = () => {
      proxySocket.destroy()
      clientSocket.destroy()
    }
    proxySocket.on('error', cleanup)
    clientSocket.on('error', cleanup)
    proxySocket.on('close', cleanup)
    clientSocket.on('close', cleanup)
  })

  proxyReq.on('error', () => {
    if (!clientSocket.destroyed) clientSocket.destroy()
  })

  proxyReq.end()
}
