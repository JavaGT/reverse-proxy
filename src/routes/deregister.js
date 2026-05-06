export async function deregisterHandler(request, reply) {
  const { host, subdomain } = request.body || {}
  const key = host || subdomain

  if (!key) {
    return reply.code(400).send({ error: 'host is required' })
  }

  const removed = request.server.registry.deregister(key)
  if (!removed) {
    return reply.code(404).send({ error: 'Service not found' })
  }

  return reply.code(200).send({ success: true })
}
