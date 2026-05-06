export async function servicesHandler(request, reply) {
  const services = request.server.registry.getServices()
  return reply.code(200).send({ services })
}
