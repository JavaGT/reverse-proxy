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
