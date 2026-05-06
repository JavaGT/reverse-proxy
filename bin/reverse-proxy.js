#!/usr/bin/env node
import { config } from '../src/config.js'
import { start } from '../src/index.js'
import { Command } from 'commander'

const program = new Command()

program
  .name('reverse-proxy')
  .description('Personal production reverse proxy')
  .version('1.0.0')

program
  .command('start')
  .description('Start the proxy server')
  .option('-p, --port <port>', 'HTTP port', String(config.port))
  .option('-h, --host <host>', 'Listen host', config.host)
  .option('--https-port <port>', 'HTTPS port', String(config.httpsPort))
  .option('--api-key <key>', 'API key for control plane')
  .option('--acme-email <email>', 'ACME email for HTTPS')
  .option('--acme-domains <domains>', 'Comma-separated ACME domains')
  .option('--acme-staging', 'Use Let\'s Encrypt staging')
  .option('--ttl <ms>', 'Heartbeat TTL in ms', String(config.ttlMs))
  .option('--cleanup-interval <ms>', 'Cleanup interval in ms', String(config.cleanupIntervalMs))
  .option('--admin-port <port>', 'Admin UI port', String(config.adminPort))
  .action(async (options) => {
    process.env.PROXY_PORT = options.port
    process.env.PROXY_HOST = options.host
    process.env.PROXY_HTTPS_PORT = options.httpsPort
    if (options.apiKey) process.env.PROXY_API_KEY = options.apiKey
    if (options.acmeEmail) process.env.PROXY_ACME_EMAIL = options.acmeEmail
    if (options.acmeDomains) process.env.PROXY_ACME_DOMAINS = options.acmeDomains
    if (options.acmeStaging) process.env.PROXY_ACME_STAGING = 'true'
    process.env.TTL_MS = options.ttl
    process.env.CLEANUP_INTERVAL_MS = options.cleanupInterval
    if (options.adminPort) process.env.PROXY_ADMIN_PORT = options.adminPort
    await start()
  })

program
  .command('register')
  .description('Register a service with the proxy')
  .argument('<host>', 'Hostname to register (e.g. foo.javagrant.ac.nz)')
  .argument('<port>', 'Backend service port')
  .option('-u, --proxy-url <url>', 'Proxy control plane URL', `http://localhost:${config.port}`)
  .option('-k, --api-key <key>', 'API key', config.apiKey)
  .option('--no-heartbeat', 'Register as permaclaim (no heartbeat)')
  .action(async (host, port, options) => {
    const body = { host, port: Number(port), heartbeat: options.heartbeat }
    const res = await fetch(`${options.proxyUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': options.apiKey },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (data.success) {
      console.log(`Registered ${host} on port ${port}`)
    } else {
      console.error('Registration failed:', data.error || data)
      process.exit(1)
    }
  })

program
  .command('deregister')
  .description('Deregister a service from the proxy')
  .argument('<host>', 'Hostname to deregister')
  .option('-u, --proxy-url <url>', 'Proxy control plane URL', `http://localhost:${config.port}`)
  .option('-k, --api-key <key>', 'API key', config.apiKey)
  .action(async (host, options) => {
    const res = await fetch(`${options.proxyUrl}/deregister`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-api-key': options.apiKey },
      body: JSON.stringify({ host }),
    })
    const data = await res.json()
    if (data.success) {
      console.log(`Deregistered ${host}`)
    } else {
      console.error('Deregistration failed:', data.error || data)
      process.exit(1)
    }
  })

program
  .command('services')
  .alias('list')
  .description('List registered services')
  .option('-u, --proxy-url <url>', 'Proxy control plane URL', `http://localhost:${config.port}`)
  .option('-k, --api-key <key>', 'API key', config.apiKey)
  .action(async (options) => {
    const res = await fetch(`${options.proxyUrl}/services`, {
      headers: { 'x-api-key': options.apiKey },
    })
    const data = await res.json()
    if (data.services) {
      const entries = Object.entries(data.services)
      if (entries.length === 0) {
        console.log('No services registered')
      } else {
        for (const [host, svc] of entries) {
          const type = svc.heartbeat ? 'heartbeat' : 'permaclaim'
          const alive = svc.lastHeartbeat
            ? `last heartbeat ${new Date(svc.lastHeartbeat).toISOString()}`
            : 'no heartbeat'
          console.log(`${host} → :${svc.port}  [${type}]  ${alive}`)
        }
      }
    } else {
      console.error('Failed to list services:', data.error || data)
      process.exit(1)
    }
  })

program.parse()
