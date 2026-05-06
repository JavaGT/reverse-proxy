import { test, describe, mock } from 'node:test'
import assert from 'node:assert'
import { ServiceRegistry } from '../src/registry/store.js'
import { startCleanupTask } from '../src/registry/cleanup.js'

describe('ServiceRegistry', () => {
  test('register creates a new heartbeat service', () => {
    const r = new ServiceRegistry()
    const result = r.register('foo', { port: 3001 })
    assert.equal(result.success, true)
    const svc = r.get('foo')
    assert.equal(svc.port, 3001)
    assert.equal(svc.heartbeat, true)
    assert.equal(typeof svc.lastHeartbeat, 'number')
  })

  test('register creates a permaclaim service when heartbeat is false', () => {
    const r = new ServiceRegistry()
    const result = r.register('bar', { port: 3002, heartbeat: false })
    assert.equal(result.success, true)
    const svc = r.get('bar')
    assert.equal(svc.heartbeat, false)
    assert.equal(svc.lastHeartbeat, null)
  })

  test('register rejects overwrite of permaclaim service', () => {
    const r = new ServiceRegistry()
    r.register('locked', { port: 3001, heartbeat: false })
    const result = r.register('locked', { port: 3002 })
    assert.equal(result.success, false)
    assert.equal(result.reason, 'permaclaim')
  })

  test('register rejects overwrite of active heartbeat service', () => {
    const r = new ServiceRegistry(100_000)
    r.register('active', { port: 3001 })
    const result = r.register('active', { port: 3002 })
    assert.equal(result.success, false)
    assert.equal(result.reason, 'active')
  })

  test('register overwrites stale heartbeat service', () => {
    const r = new ServiceRegistry(1)
    r.register('stale', { port: 3001 })
    const svc = r.get('stale')
    svc.lastHeartbeat = Date.now() - 100_000

    const result = r.register('stale', { port: 3002 })
    assert.equal(result.success, true)
    assert.equal(r.get('stale').port, 3002)
  })

  test('heartbeat updates lastHeartbeat on existing service', () => {
    const r = new ServiceRegistry()
    r.register('foo', { port: 3001 })
    const before = r.get('foo').lastHeartbeat
    const ok = r.heartbeat('foo')
    assert.equal(ok, true)
    assert.ok(r.get('foo').lastHeartbeat >= before)
  })

  test('heartbeat on permaclaim service still updates lastHeartbeat', () => {
    const r = new ServiceRegistry()
    r.register('foo', { port: 3001, heartbeat: false })
    const svc = r.get('foo')
    assert.equal(svc.lastHeartbeat, null)
    const ok = r.heartbeat('foo')
    assert.equal(ok, true)
    assert.equal(typeof r.get('foo').lastHeartbeat, 'number')
  })

  test('heartbeat on unknown subdomain returns false', () => {
    const r = new ServiceRegistry()
    assert.equal(r.heartbeat('nonexistent'), false)
  })

  test('deregister removes a service', () => {
    const r = new ServiceRegistry()
    r.register('foo', { port: 3001 })
    assert.equal(r.deregister('foo'), true)
    assert.equal(r.get('foo'), null)
  })

  test('deregister on unknown subdomain returns false', () => {
    const r = new ServiceRegistry()
    assert.equal(r.deregister('nonexistent'), false)
  })

  test('getServices returns all services with heartbeat flag', () => {
    const r = new ServiceRegistry()
    r.register('a', { port: 1, heartbeat: true })
    r.register('b', { port: 2, heartbeat: false })
    const svcs = r.getServices()
    assert.equal(svcs.a.heartbeat, true)
    assert.equal(svcs.b.heartbeat, false)
    assert.equal(typeof svcs.a.lastHeartbeat, 'number')
    assert.equal(svcs.b.lastHeartbeat, null)
  })

  test('findStaleServices skips permaclaim services', () => {
    const r = new ServiceRegistry(1)
    r.register('perm', { port: 3001, heartbeat: false })
    r.register('hb', { port: 3002 })
    r.get('hb').lastHeartbeat = Date.now() - 100_000
    const stale = [...r.findStaleServices()]
    assert.deepEqual(stale, ['hb'])
  })

  test('findStaleServices returns empty when all services are alive', () => {
    const r = new ServiceRegistry(100_000)
    r.register('a', { port: 1 })
    r.register('b', { port: 2 })
    assert.equal([...r.findStaleServices()].length, 0)
  })
})

describe('startCleanupTask', () => {
  test('removes stale heartbeat services but not permaclaim', () => {
    const r = new ServiceRegistry(1)
    r.register('hb', { port: 3001 })
    r.register('perm', { port: 3002, heartbeat: false })
    r.get('hb').lastHeartbeat = Date.now() - 100_000

    const stop = startCleanupTask(r, 10, { info: () => {} })

    return new Promise((resolve) => {
      setTimeout(() => {
        stop()
        assert.equal(r.get('hb'), null, 'stale heartbeat service was removed')
        assert.equal(r.get('perm').heartbeat, false, 'permaclaim service survived')
        resolve()
      }, 50)
    })
  })
})
