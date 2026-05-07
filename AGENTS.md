# AGENTS.md — reverse-proxy

## Repository

```yaml
root: @javagt/reverse-proxy  (proxy server + CLI)
sdk/: @javagt/reverse-proxy-client  (workspace, separate npm package)
npm publish: requires OTP/2FA under @javagt scope
```

## Entrypoints

| What | File |
|---|---|
| Server | `src/index.js` (exports `start()`; also runs directly) |
| CLI | `bin/reverse-proxy.js` (commands: `start`, `register`, `deregister`, `services`) |
| SDK | `sdk/src/index.js` (class `ReverseProxySDK`) |

## Commands

```sh
npm test              # node --test tests/*.test.js sdk/tests/*.test.js
npm start             # node src/index.js
npm run start:cli     # node bin/reverse-proxy.js start
npm publish -w sdk    # publish SDK only
```

## Architecture

- Three Fastify servers in one process sharing a single in-memory `ServiceRegistry`:
  - **HTTP** on `PROXY_PORT` (default 9080)
  - **HTTPS** on `PROXY_HTTPS_PORT` (default 9443, only if ACME is configured)
  - **Admin UI** on `PROXY_ADMIN_PORT` (default 9090, bound to `127.0.0.1` only)
- Routing key: full `Host` header (lowercased), not subdomain extraction
- Control plane routes (`/register`, `/heartbeat`, `/deregister`, `/services`) are protected by `x-api-key` header and placed **before** the catch-all proxy route so they take priority
- ACME certs stored in `data/` (gitignored)

## Domain model (see CONTEXT.md)

- **Service** — a backend registered under a hostname. Two types:
  - **Heartbeat Service**: sends periodic heartbeats; evicted if stale past TTL (default 30s)
  - **Permaclaim Service**: `heartbeat: false`, never evicted or overwritten
- **Stale**: heartbeat service whose `lastHeartbeat` is older than TTL
- Registration overwrite rules: permaclaim → reject; active heartbeat → reject; stale heartbeat → allow

## Testing

- Uses Node.js built-in `node:test` + `node:assert`
- Integration tests use Fastify's `server.inject()` (no real HTTP)
- Test files: `tests/registry.test.js`, `tests/server.test.js`, `sdk/tests/index.test.js`
- Registry tests create fresh `ServiceRegistry` instances per test
- Server tests use `withServer()` helper that creates a registry + server per test

## Known issues / traps

- **WebSocket proxy**: the `handleWebSocket` function writes raw bytes to the socket after `reply.hijack()`. It's likely broken — the `ws` library's decoded messages need WebSocket framing before being written to the client socket. Not yet tested/fixed.
- **Admin UI JS**: the HTML template is embedded as a template literal (`const PAGE = \`...\``) in `src/admin.js`. Never use inline `onclick` attributes with `\'` escaping inside it — the template literal escaping breaks. Use `data-` attributes with event delegation instead.
- **DELETE body**: `request.body` can be undefined for DELETE. Always guard with `request.body || {}`.
- **Headers forwarding**: `reply.send(proxyRes)` (stream) does NOT forward response headers. Must set them explicitly via `reply.headers()`.
- **Body consumed by Fastify**: For POST/PUT/PATCH, Fastify parses the body, draining `request.raw`. The proxy handler re-serializes `request.body` instead of piping raw.

## Config

All config via environment variables (`dotenv` reads `.env`). CLI flags override env vars. Key variables with defaults:

```
PROXY_PORT=9080  PROXY_HOST=0.0.0.0  PROXY_HTTPS_PORT=9443
PROXY_API_KEY=dev-secret-change-me
PROXY_ADMIN_PORT=9090
TTL_MS=30000  CLEANUP_INTERVAL_MS=5000  HEALTH_CHECK_INTERVAL_MS=15000
```

ACME (wildcard cert via Porkbun DNS-01):
```
PROXY_ACME_EMAIL=admin@example.com
PROXY_ACME_DOMAINS=*.javagrant.ac.nz,javagrant.ac.nz
PORKBUN_API_KEY=pk1_...  PORKBUN_SECRET_KEY=sk1_...
```
