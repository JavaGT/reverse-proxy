# reverse-proxy

A personal production reverse proxy that routes HTTP and WebSocket traffic to locally-registered backend services by hostname. Runs on a single machine, managed via an API-key-authenticated control plane.

```bash
npm install -g @javagt/reverse-proxy
reverse-proxy start --port 9080 --https-port 9443
```

## Features

- **Hostname-based routing** — route by full hostname (`foo.example.com`, `bar.other.com`, `example.com`)
- **HTTP + WebSocket proxying** — forward both regular and WebSocket traffic to backends
- **Heartbeat Services** — services that send periodic heartbeats; evicted automatically if they go silent
- **Permaclaim Services** — register once, never evicted, no heartbeats needed
- **Automatic HTTPS** — built-in ACME (Let's Encrypt) with DNS-01 challenge support via Porkbun
- **Health check polling** — proxy can actively poll a service's health endpoint as an alternative heartbeat mechanism
- **Control plane API** — REST API for registration, deregistration, and listing services
- **SDK** — JavaScript SDK for easy service registration in Node.js apps

## CLI

### Start the proxy

```bash
reverse-proxy start [options]
```

| Option | Env var | Default |
|---|---|---|
| `-p, --port` | `PROXY_PORT` | `9080` |
| `-h, --host` | `PROXY_HOST` | `localhost` |
| `--https-port` | `PROXY_HTTPS_PORT` | `9443` |
| `--api-key` | `PROXY_API_KEY` | `dev-secret-change-me` |
| `--acme-email` | `PROXY_ACME_EMAIL` | — |
| `--acme-domains` | `PROXY_ACME_DOMAINS` | — |
| `--acme-staging` | `PROXY_ACME_STAGING` | `false` |
| `--ttl` | `TTL_MS` | `30000` |
| `--cleanup-interval` | `CLEANUP_INTERVAL_MS` | `5000` |

### Admin UI

A local-only dashboard is available at `http://127.0.0.1:9090` (bound to localhost only — not accessible from the network). Shows registered services, status, heartbeats, and lets you register/deregister.

```bash
reverse-proxy start --admin-port 9090
```

### Manage services

```bash
# Register a heartbeat service
reverse-proxy register hello.example.com 8080

# Register a permaclaim service (no heartbeat)
reverse-proxy register hello.example.com 8080 --no-heartbeat

# Deregister
reverse-proxy deregister hello.example.com

# List services
reverse-proxy services
```

Each command accepts `--proxy-url` and `--api-key` to connect to a remote proxy:

```bash
reverse-proxy services --proxy-url http://192.168.1.100:9080 --api-key my-secret
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PROXY_PORT` | `9080` | HTTP listen port |
| `PROXY_HOST` | `localhost` | Listen address |
| `PROXY_HTTPS_PORT` | `9443` | HTTPS listen port |
| `PROXY_API_KEY` | `dev-secret-change-me` | API key for control plane |
| `PROXY_ACME_EMAIL` | — | Email for Let's Encrypt registration |
| `PROXY_ACME_DOMAINS` | — | Comma-separated domains for cert (e.g. `*.example.com,example.com`) |
| `PROXY_ACME_STAGING` | `false` | Use Let's Encrypt staging endpoint |
| `PORKBUN_API_KEY` | — | Porkbun API key (for wildcard DNS-01 challenges) |
| `PORKBUN_SECRET_KEY` | — | Porkbun secret API key |
| `TTL_MS` | `30000` | Heartbeat TTL in milliseconds |
| `CLEANUP_INTERVAL_MS` | `5000` | Stale service cleanup interval |
| `HEALTH_CHECK_INTERVAL_MS` | `15000` | Health check polling interval |
| `PROXY_ADMIN_PORT` | `9090` | Local-only admin UI port |

## SDK

```bash
npm install @javagt/reverse-proxy-client
```

```js
import { ReverseProxySDK } from '@javagt/reverse-proxy-client'

const sdk = new ReverseProxySDK({
  proxyUrl: 'http://localhost:9080',
  host: 'myapp.example.com',    // full hostname — must match what clients will connect to
  port: 8080,
  apiKey: 'your-api-key',
  healthCheckUrl: '/health',     // optional — endpoint the proxy can poll
  heartbeatIntervalMs: 10_000,   // optional — how often to send heartbeats
})

sdk.on('onRegisterSuccess', ({ host }) => console.log(`Registered: ${host}`))
sdk.on('onDeregistered', ({ host }) => console.log(`Deregistered: ${host}`))
sdk.on('onError', ({ action, error, retrying }) => {
  if (retrying) {
    console.error(`${action} failed, will retry:`, error.message)
  } else {
    console.error(`${action} failed:`, error.message)
  }
})

await sdk.register()

// Optional — CLI-style scripts: deregister on SIGINT/SIGTERM then `process.exit`
sdk.registerShutdownHooks()
```

| Option | Default | Description |
|---|---|---|
| `proxyUrl` | — | URL of the reverse proxy control plane (e.g. `http://proxy.example.com:9080`) |
| `host` | — | **Full hostname** clients will use (e.g. `myapp.example.com` — **not** just `myapp`) |
| `port` | — | Local port the service is running on |
| `apiKey` | — | API key for the proxy control plane |
| `healthCheckUrl` | — | Path the proxy can poll to verify the service is healthy |
| `heartbeatIntervalMs` | `10000` | How often (ms) to send heartbeat requests |

> **⚠️ `host` must be the full domain.** `host: 'myapp'` will register as `myapp`, not `myapp.example.com`. Use `host: 'myapp.example.com'` for the proxy to route `myapp.example.com` to your service.

### Reconnection & error handling

The SDK automatically retries registration with exponential backoff (1s, 2s, 4s, 8s, up to 30s max) until the proxy responds. If a heartbeat fails — for example because the proxy restarted and lost all registrations — the SDK re-registers automatically. The `onError` event fires with `retrying: true` on each failed retry attempt.

```js
sdk.on('onError', ({ action, error, retrying }) => {
  if (retrying) {
    console.log(`Re-registration attempt failed: ${error.message}`)
  }
})
```

### Graceful shutdown

On `SIGTERM` or `SIGINT`, the SDK automatically deregisters the service from the proxy before exiting. No additional setup required.

## API

All control plane requests require the `x-api-key` header.

### `POST /register`
```json
{ "host": "foo.example.com", "port": 8080, "heartbeat": true }
```

### `POST /heartbeat`
```json
{ "host": "foo.example.com" }
```

### `DELETE /deregister`
```json
{ "host": "foo.example.com" }
```

### `GET /services`
Returns a map of hostnames to service details.

## License

MIT
