import { test } from 'node:test'
import assert from 'node:assert'
import { ReverseProxySDK } from '../src/index.js'

test('ReverseProxySDK constructor sets fields', () => {
  const sdk = new ReverseProxySDK({
    proxyUrl: 'http://localhost:3000',
    subdomain: 'myapp',
    port: 8080,
    apiKey: 'secret',
  })

  assert.equal(sdk.proxyUrl, 'http://localhost:3000')
  assert.equal(sdk.subdomain, 'myapp')
  assert.equal(sdk.port, 8080)
  assert.equal(sdk.apiKey, 'secret')
  assert.equal(sdk.heartbeatIntervalMs, 10_000)
})

test('ReverseProxySDK on() registers event handlers', () => {
  const sdk = new ReverseProxySDK({
    proxyUrl: 'http://localhost:3000',
    subdomain: 'myapp',
    port: 8080,
    apiKey: 'secret',
  })

  let called = false
  sdk.on('onRegisterSuccess', () => { called = true })
  sdk.on('onRegisterSuccess', () => { called = true })

  assert.equal(sdk.events.onRegisterSuccess.length, 2)
})

test('ReverseProxySDK emit() calls event handlers', () => {
  const sdk = new ReverseProxySDK({
    proxyUrl: 'http://localhost:3000',
    subdomain: 'myapp',
    port: 8080,
    apiKey: 'secret',
  })

  let count = 0
  sdk.on('onError', (err) => { count++ })
  sdk.on('onError', (err) => { count++ })

  sdk.emit('onError', { message: 'test' })
  assert.equal(count, 2)
})

test('constructor does not install process signal listeners', () => {
  const beforeInt = process.listenerCount('SIGINT')
  const beforeTerm = process.listenerCount('SIGTERM')
  const sdk = new ReverseProxySDK({
    proxyUrl: 'http://localhost:3000',
    subdomain: 'myapp',
    port: 8080,
    apiKey: 'secret',
  })
  assert.ok(sdk)
  assert.equal(process.listenerCount('SIGINT'), beforeInt)
  assert.equal(process.listenerCount('SIGTERM'), beforeTerm)
})

test('register() does not install process signal listeners', async () => {
  const beforeInt = process.listenerCount('SIGINT')
  const beforeTerm = process.listenerCount('SIGTERM')
  const sdk = new ReverseProxySDK({
    proxyUrl: 'http://localhost:3000',
    host: 'test.example.com',
    port: 8080,
    apiKey: 'secret',
  })
  sdk._request = async () => ({ ok: true })
  await sdk.register()
  assert.equal(process.listenerCount('SIGINT'), beforeInt)
  assert.equal(process.listenerCount('SIGTERM'), beforeTerm)
  sdk._stopped = true
  clearInterval(sdk.heartbeatTimer)
})

test('registerShutdownHooks() installs SIGINT and SIGTERM listeners', async (t) => {
  const beforeInt = process.listenerCount('SIGINT')
  const beforeTerm = process.listenerCount('SIGTERM')
  const sdk = new ReverseProxySDK({
    proxyUrl: 'http://localhost:3000',
    host: 'test.example.com',
    port: 8080,
    apiKey: 'secret',
  })
  sdk.registerShutdownHooks()
  assert.equal(process.listenerCount('SIGINT'), beforeInt + 1)
  assert.equal(process.listenerCount('SIGTERM'), beforeTerm + 1)
  t.after(() => {
    if (sdk._shutdownHook) {
      process.removeListener('SIGINT', sdk._shutdownHook)
      process.removeListener('SIGTERM', sdk._shutdownHook)
    }
  })
})

test('registerShutdownHooks on signal deregisters then exits (mocked process.exit)', async (t) => {
  const exitCodes = []
  const origExit = process.exit
  process.exit = (code) => { exitCodes.push(code) }
  t.after(() => { process.exit = origExit })

  const sdk = new ReverseProxySDK({
    proxyUrl: 'http://localhost:3000',
    host: 'sig.example.com',
    port: 9000,
    apiKey: 'secret',
  })
  let deregisterCalls = 0
  sdk._request = async (method, path) => {
    if (path === '/deregister') {
      deregisterCalls++
      return { ok: true }
    }
    return {}
  }

  sdk.registerShutdownHooks({ exitCode: 2 })
  t.after(() => {
    if (sdk._shutdownHook) {
      process.removeListener('SIGINT', sdk._shutdownHook)
      process.removeListener('SIGTERM', sdk._shutdownHook)
    }
  })

  process.emit('SIGINT')
  await new Promise((r) => setTimeout(r, 80))

  assert.equal(deregisterCalls, 1)
  assert.deepEqual(exitCodes, [2])
})

test('registerShutdownHooks still exits when deregister fails', async (t) => {
  const exitCodes = []
  const origExit = process.exit
  process.exit = (code) => { exitCodes.push(code) }
  t.after(() => { process.exit = origExit })

  const sdk = new ReverseProxySDK({
    proxyUrl: 'http://localhost:3000',
    host: 'fail.example.com',
    port: 9001,
    apiKey: 'secret',
  })
  sdk._request = async (method, path) => {
    if (path === '/deregister') throw new Error('network')
    return {}
  }
  const errors = []
  sdk.on('onError', (e) => { errors.push(e) })

  sdk.registerShutdownHooks()
  t.after(() => {
    if (sdk._shutdownHook) {
      process.removeListener('SIGINT', sdk._shutdownHook)
      process.removeListener('SIGTERM', sdk._shutdownHook)
    }
  })

  process.emit('SIGTERM')
  await new Promise((r) => setTimeout(r, 80))

  assert.ok(errors.some((e) => e.action === 'deregister'))
  assert.deepEqual(exitCodes, [0])
})

test('register retries on failure then succeeds', async () => {
  const sdk = new ReverseProxySDK({
    proxyUrl: 'http://localhost:3000',
    host: 'test.example.com',
    port: 8080,
    apiKey: 'secret',
  })

  let attempts = 0
  sdk._request = async () => {
    attempts++
    if (attempts === 1) throw new Error('connection refused')
  }

  const errors = []
  sdk.on('onError', (e) => { errors.push(e) })

  await sdk.register()

  assert.equal(attempts, 2)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].action, 'register')
  assert.equal(errors[0].retrying, true)

  sdk._stopped = true
  clearInterval(sdk.heartbeatTimer)
})

test('heartbeat failure triggers re-register', async () => {
  const sdk = new ReverseProxySDK({
    proxyUrl: 'http://localhost:3000',
    host: 'test.example.com',
    port: 8080,
    apiKey: 'secret',
    heartbeatIntervalMs: 50,
  })

  let heartbeatAttempts = 0
  let registerAttempts = 0

  sdk._request = async (method, path) => {
    if (path === '/heartbeat') {
      heartbeatAttempts++
      throw new Error('heartbeat failed')
    }
    if (path === '/register') {
      registerAttempts++
      return { success: true }
    }
  }

  sdk.registered = true
  sdk._startHeartbeat()

  await new Promise(r => setTimeout(r, 250))

  sdk._stopped = true
  clearInterval(sdk.heartbeatTimer)

  assert.ok(heartbeatAttempts >= 1, 'heartbeat should have been attempted')
  assert.ok(registerAttempts >= 1, 're-register should have been triggered')
})
