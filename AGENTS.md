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

- One process, one in-memory `ServiceRegistry`, **no Fastify**:
  - **HTTP** — `http.createServer` on `PROXY_PORT` (default 9080)
  - **HTTPS** — `http2.createSecureServer({ allowHTTP1: true, ...tls })` on `PROXY_HTTPS_PORT` (default 9443, only if ACME is configured)
  - **Admin UI** — plain `http.createServer` on `PROXY_ADMIN_PORT` (default 9090, bound to `127.0.0.1` only)
- Public traffic forwarding uses **`http2-proxy`** (`proxy.web` / `proxy.ws`) so request bodies stream to upstream (no framework body buffering on proxy paths)
- Routing key: full `Host` header (lowercased), not subdomain extraction
- Control plane routes (`/register`, `/heartbeat`, `/deregister`, `/services`) are protected by `x-api-key` header and handled **before** the catch-all proxy
- ACME certs stored in `data/` (gitignored)

## Domain model (see CONTEXT.md)

- **Service** — a backend registered under a hostname. Two types:
  - **Heartbeat Service**: sends periodic heartbeats; evicted if stale past TTL (default 30s)
  - **Permaclaim Service**: `heartbeat: false`, never evicted or overwritten
- **Stale**: heartbeat service whose `lastHeartbeat` is older than TTL
- Registration overwrite rules: permaclaim → reject; active heartbeat → reject; stale heartbeat → allow

## Testing

- Uses Node.js built-in `node:test` + `node:assert`
- Server integration tests bind an ephemeral port and use **`fetch`** against `127.0.0.1` (see `buildServer().inject()` in `src/server.js`)
- Test files: `tests/registry.test.js`, `tests/server.test.js`, `sdk/tests/index.test.js`
- Registry tests create fresh `ServiceRegistry` instances per test
- Server tests use `withServer()` helper that creates a registry + server per test

## Known issues / traps

- **Admin UI JS**: the HTML template is embedded as a template literal (`const PAGE = \`...\``) in `src/admin.js`. Never use inline `onclick` attributes with `\'` escaping inside it — the template literal escaping breaks. Use `data-` attributes with event delegation instead.
- **DELETE body**: control-plane handlers use `request.body || {}` when reading JSON.
- **HTTPS listener**: TLS renewal updates the secure context via `httpsServer.server.setSecureContext({ key, cert })` on the `http2.Http2SecureServer` instance.

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
