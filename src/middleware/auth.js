import { timingSafeEqual } from 'crypto'
import { config } from '../config.js'

export async function apiKeyAuth(request, reply) {
  const apiKey = request.headers['x-api-key']

  if (!apiKey) {
    return reply.code(401).send({ error: 'Missing API key' })
  }

  const keyBuffer = Buffer.from(apiKey)
  const expectedBuffer = Buffer.from(config.apiKey)

  if (keyBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(keyBuffer, expectedBuffer)) {
    return reply.code(401).send({ error: 'Invalid API key' })
  }
}
