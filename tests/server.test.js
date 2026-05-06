import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { ServiceRegistry } from '../src/registry/store.js'
import { buildServer } from '../src/server.js'

function withServer(fn) {
  return async (t) => {
    const registry = new ServiceRegistry(100_000)
    const server = buildServer(registry)
    t.after(() => server.close())
    await server.ready()
    await fn(t, server, registry)
  }
}

function authHeaders() {
  return { 'x-api-key': 'dev-secret-change-me' }
}

describe('Auth middleware', () => {
  test('rejects requests without API key', withServer(async (t, server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/register',
      payload: { subdomain: 'foo', port: 3001 },
    })
    assert.equal(res.statusCode, 401)
    assert.equal(res.json().error, 'Missing API key')
  }))

  test('rejects requests with wrong API key', withServer(async (t, server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/register',
      headers: { 'x-api-key': 'wrong' },
      payload: { subdomain: 'foo', port: 3001 },
    })
    assert.equal(res.statusCode, 401)
    assert.equal(res.json().error, 'Invalid API key')
  }))
})

describe('POST /register', () => {
  test('registers a new heartbeat service', withServer(async (t, server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/register',
      headers: authHeaders(),
      payload: { subdomain: 'foo', port: 3001 },
    })
    assert.equal(res.statusCode, 201)
    assert.equal(res.json().success, true)
  }))

  test('registers a permaclaim service', withServer(async (t, server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/register',
      headers: authHeaders(),
      payload: { subdomain: 'perm', port: 3001, heartbeat: false },
    })
    assert.equal(res.statusCode, 201)
  }))

  test('rejects registration with missing subdomain', withServer(async (t, server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/register',
      headers: authHeaders(),
      payload: { port: 3001 },
    })
    assert.equal(res.statusCode, 400)
  }))

  test('rejects overwrite of permaclaim service', withServer(async (t, server, registry) => {
    registry.register('locked', { port: 3001, heartbeat: false })
    const res = await server.inject({
      method: 'POST',
      url: '/register',
      headers: authHeaders(),
      payload: { subdomain: 'locked', port: 3002 },
    })
    assert.equal(res.statusCode, 409)
    assert.match(res.json().error, /permaclaim/i)
  }))

  test('rejects overwrite of active heartbeat service', withServer(async (t, server, registry) => {
    registry.register('active', { port: 3001 })
    const res = await server.inject({
      method: 'POST',
      url: '/register',
      headers: authHeaders(),
      payload: { subdomain: 'active', port: 3002 },
    })
    assert.equal(res.statusCode, 409)
    assert.match(res.json().error, /active/i)
  }))

  test('overwrites stale heartbeat service', withServer(async (t, server, registry) => {
    registry.register('stale', { port: 3001 })
    registry.get('stale').lastHeartbeat = Date.now() - 100_000
    registry.ttlMs = 1

    const res = await server.inject({
      method: 'POST',
      url: '/register',
      headers: authHeaders(),
      payload: { subdomain: 'stale', port: 3002 },
    })
    assert.equal(res.statusCode, 201)
  }))
})

describe('POST /heartbeat', () => {
  test('updates heartbeat on existing service', withServer(async (t, server, registry) => {
    registry.register('foo', { port: 3001 })
    const before = registry.get('foo').lastHeartbeat
    const res = await server.inject({
      method: 'POST',
      url: '/heartbeat',
      headers: authHeaders(),
      payload: { subdomain: 'foo' },
    })
    assert.equal(res.statusCode, 200)
    assert.ok(registry.get('foo').lastHeartbeat >= before)
  }))

  test('returns 404 for unknown subdomain', withServer(async (t, server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/heartbeat',
      headers: authHeaders(),
      payload: { subdomain: 'nonexistent' },
    })
    assert.equal(res.statusCode, 404)
  }))
})

describe('DELETE /deregister', () => {
  test('removes an existing service', withServer(async (t, server, registry) => {
    registry.register('foo', { port: 3001 })
    const res = await server.inject({
      method: 'DELETE',
      url: '/deregister',
      headers: authHeaders(),
      payload: { subdomain: 'foo' },
    })
    assert.equal(res.statusCode, 200)
    assert.equal(registry.get('foo'), null)
  }))

  test('returns 404 for unknown subdomain', withServer(async (t, server) => {
    const res = await server.inject({
      method: 'DELETE',
      url: '/deregister',
      headers: authHeaders(),
      payload: { subdomain: 'nonexistent' },
    })
    assert.equal(res.statusCode, 404)
  }))
})

describe('host-based routing', () => {
  test('register accepts host field for full hostname', withServer(async (t, server, registry) => {
    const res = await server.inject({
      method: 'POST',
      url: '/register',
      headers: authHeaders(),
      payload: { host: 'foo.javagrant.ac.nz', port: 3001 },
    })
    assert.equal(res.statusCode, 201)
    assert.equal(registry.get('foo.javagrant.ac.nz').port, 3001)
  }))

  test('register accepts subdomain as backward-compatible alias', withServer(async (t, server, registry) => {
    const res = await server.inject({
      method: 'POST',
      url: '/register',
      headers: authHeaders(),
      payload: { subdomain: 'bare', port: 3001 },
    })
    assert.equal(res.statusCode, 201)
    assert.equal(registry.get('bare').port, 3001)
  }))

  test('two different hosts can coexist without collision', withServer(async (t, server, registry) => {
    registry.register('foo.javagrant.ac.nz', { port: 3001 })
    registry.register('foo.other.com', { port: 3002 })
    assert.equal(registry.get('foo.javagrant.ac.nz').port, 3001)
    assert.equal(registry.get('foo.other.com').port, 3002)
  }))

  test('bare domain can be registered', withServer(async (t, server, registry) => {
    const res = await server.inject({
      method: 'POST',
      url: '/register',
      headers: authHeaders(),
      payload: { host: 'javagrant.ac.nz', port: 3001 },
    })
    assert.equal(res.statusCode, 201)
    assert.equal(registry.get('javagrant.ac.nz').port, 3001)
  }))
})

describe('ACME challenge route', () => {
  test('returns 404 for unknown token', withServer(async (t, server) => {
    const res = await server.inject({
      method: 'GET',
      url: '/.well-known/acme-challenge/nonexistent',
    })
    assert.equal(res.statusCode, 404)
  }))

  test('returns key authorization for known token', withServer(async (t, server) => {
    const { challenges } = await import('../src/tls.js')
    challenges.set('mytoken', 'mykeyauth')
    t.after(() => challenges.delete('mytoken'))

    const res = await server.inject({
      method: 'GET',
      url: '/.well-known/acme-challenge/mytoken',
    })
    assert.equal(res.statusCode, 200)
    assert.equal(res.body, 'mykeyauth')
  }))
})

describe('GET /services', () => {
  test('lists registered services with heartbeat flag', withServer(async (t, server, registry) => {
    registry.register('a', { port: 3001 })
    registry.register('b', { port: 3002, heartbeat: false })
    const res = await server.inject({
      method: 'GET',
      url: '/services',
      headers: authHeaders(),
    })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.services.a.heartbeat, true)
    assert.equal(body.services.b.heartbeat, false)
  }))
})
