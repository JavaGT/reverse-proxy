export async function registerHandler(request, reply) {
  const { host, subdomain, port, healthCheckUrl, heartbeat } = request.body
  const key = host || subdomain

  if (!key || !port) {
    return reply.code(400).send({ error: 'host and port are required' })
  }

  const result = request.server.registry.register(key, { port, healthCheckUrl, heartbeat })

  if (!result.success) {
    const msg = result.reason === 'permaclaim'
      ? 'Host is permaclaimed'
      : result.reason === 'active'
        ? 'Host has an active heartbeat registration'
        : 'Registration conflict'
    return reply.code(409).send({ error: msg })
  }

  return reply.code(201).send({ success: true, host: key })
}
