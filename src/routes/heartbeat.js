export async function heartbeatHandler(request, reply) {
  const { host, subdomain } = request.body || {}
  const key = host || subdomain

  if (!key) {
    return reply.code(400).send({ error: 'host is required' })
  }

  const ok = request.server.registry.heartbeat(key)
  if (!ok) {
    return reply.code(404).send({ error: 'Service not found' })
  }

  return reply.code(200).send({ success: true })
}
