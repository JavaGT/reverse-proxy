import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { apiKeyAuth } from './middleware/auth.js'
import { registerHandler } from './routes/register.js'
import { heartbeatHandler } from './routes/heartbeat.js'
import { deregisterHandler } from './routes/deregister.js'
import { servicesHandler } from './routes/services.js'
import { proxyHandler } from './routes/proxy.js'
import { challenges } from './tls.js'

function addAcmeChallengeRoute(fastify) {
  fastify.get('/.well-known/acme-challenge/:token', (request, reply) => {
    const keyAuth = challenges.get(request.params.token)
    if (!keyAuth) return reply.code(404).send('Not found')
    return reply.type('text/plain').send(keyAuth)
  })
}

function addRoutes(fastify) {
  addAcmeChallengeRoute(fastify)

  fastify.post('/register', { preHandler: apiKeyAuth }, registerHandler)
  fastify.post('/heartbeat', { preHandler: apiKeyAuth }, heartbeatHandler)
  fastify.delete('/deregister', { preHandler: apiKeyAuth }, deregisterHandler)
  fastify.get('/services', { preHandler: apiKeyAuth }, servicesHandler)

  fastify.all('/*', proxyHandler)
}

export function buildServer(registry) {
  const fastify = Fastify({ logger: true })
  fastify.decorate('registry', registry)
  fastify.register(websocket)
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      const params = new URLSearchParams(body.toString())
      const parsed = {}
      for (const [key, val] of params) parsed[key] = val
      done(null, parsed)
    } catch (err) { done(err) }
  })
  addRoutes(fastify)
  return fastify
}

export function buildHttpsServer(registry, tls) {
  const fastify = Fastify({ logger: true, https: tls })
  fastify.decorate('registry', registry)
  fastify.register(websocket)
  addRoutes(fastify)
  return fastify
}
