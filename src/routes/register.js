export async function registerHandler(request, reply) {
  const { host, subdomain, port, healthCheckUrl, heartbeat } = request.body
  const key = host || subdomain

  if (!key || !port) {
    return reply.code(400).send({ error: 'host and port are required' })
  }

  const result = request.server.registry.register(key, { port, healthCheckUrl, heartbeat })

  if (!result.success) {
    if (result.reason === 'permaclaim') {
      return reply.code(409).send({ error: 'Host is permaclaimed' })
    }
    return reply.code(409).send({ error: 'Host already registered by an active service' })
  }

  return reply.code(201).send({ success: true, host: key })
}
