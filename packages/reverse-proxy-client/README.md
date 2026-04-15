# @javagt/reverse-proxy-client

Programmatic client and CLI for the reverse-proxy **management API** (`/api/v1/...` on `127.0.0.1`) and optional **SQLite** access when the server is down. The server serves integration notes at **`GET /llms.txt`** (includes this package) and machine-readable **`GET /api/v1/openapi.yaml`**.

## Install

**From npm (any project):**

```bash
npm install @javagt/reverse-proxy-client
```

Package page: [npmjs.com/package/@javagt/reverse-proxy-client](https://www.npmjs.com/package/@javagt/reverse-proxy-client).

**From the reverse-proxy monorepo root** (workspace links the package automatically):

```bash
npm install
```

**From another repo via path** (no registry publish required):

```bash
npm install @javagt/reverse-proxy-client@file:../reverse-proxy/packages/reverse-proxy-client
```

## Requirements

- Node.js **22+** (uses `globalThis.fetch` and `node:sqlite` via the main app’s persistence layer).
- Management API is **localhost-only**; run the CLI on the same host as the proxy (or tunnel to `127.0.0.1`).
- HTTP calls from **non-loopback** need an express-easy-auth **session** (same `mgmt.sid` cookie the browser gets after `POST /api/v1/auth/login` or the **`/login.html`** page). Node `fetch` does not send that cookie unless you implement login or inject a `Cookie` header yourself. Co-located **loopback** clients need no session.

### Management base URL (port discovery)

The proxy listens on **`127.0.0.1`**; the port comes from the server’s **`MANAGEMENT_INTERFACE_PORT`** (default **24789**). The HTTP client does **not** read the environment by itself — pass an explicit `baseUrl`.

- **CLI:** uses `MANAGEMENT_URL` if set, else `--url`, else `http://127.0.0.1:24789`.
- **Library:** mirror that in your app, for example:

```js
const managementPort = process.env.MANAGEMENT_INTERFACE_PORT || "24789";
const baseUrl =
    process.env.MANAGEMENT_URL?.replace(/\/$/, "") ||
    `http://127.0.0.1:${managementPort}`;

const http = createHttpClient({ baseUrl });
```

Use the same `MANAGEMENT_URL` / port as the reverse-proxy `.env` so co-located tools stay in sync when the management port is changed.

## SQLite (offline) mode

Reads and writes go through the same `RouteRegistry` + `SqlitePersistence` rules as the server. **Stop the reverse-proxy process** before using database mode for `reserve`, `release`, or `domains set`, or the database may stay locked or become inconsistent.

## Library

```js
import {
    getFetch,
    createHttpClient,
    createDbClient,
    createAutoClient,
    ManagementApiError
} from "@javagt/reverse-proxy-client";

const managementPort = process.env.MANAGEMENT_INTERFACE_PORT || "24789";
const baseUrl =
    process.env.MANAGEMENT_URL?.replace(/\/$/, "") ||
    `http://127.0.0.1:${managementPort}`;

const http = createHttpClient({
    baseUrl
});

const { data: routes } = await http.getRoutes();

const db = createDbClient({
    dbPath: process.env.SQLITE_DB_PATH || "./reverse-proxy.db",
    env: process.env
});

const auto = createAutoClient({
    baseUrl,
    dbPath: "./reverse-proxy.db"
});
// Probes GET /api/v1/health; on failure uses SQLite for health/domains/routes/reserve/release/putDomains/getDdns/putDdns/deleteDdns.
// Re-probes periodically (`modeCacheTtlMs`, default 5s) so the client can move from DB→HTTP after the proxy starts.
// If an HTTP call fails with a transport error, the client invalidates the mode cache and retries once (then may fall back to DB).
// scan, kill, getNetwork require HTTP and throw in DB-only fallback.
```

Optional `fetch` override (tests or custom stacks):

```js
createHttpClient({ baseUrl, fetch: myFetch });
createAutoClient({ ...options, fetch: myFetch });
```

## CLI

From the monorepo root (workspace):

```bash
npm exec -w @javagt/reverse-proxy-client reverse-proxy-mgmt -- health
```

Or run the bin directly:

```bash
node packages/reverse-proxy-client/bin/reverse-proxy-mgmt.mjs health
npm exec -w @javagt/reverse-proxy-client reverse-proxy-mgmt -- --mode db --db ./reverse-proxy.db routes list
npm exec -w @javagt/reverse-proxy-client reverse-proxy-mgmt -- reserve --subdomain app --base-domain example.com --port 3000
npm exec -w @javagt/reverse-proxy-client reverse-proxy-mgmt -- release app --base-domain example.com
npm exec -w @javagt/reverse-proxy-client reverse-proxy-mgmt -- ddns get
npm exec -w @javagt/reverse-proxy-client reverse-proxy-mgmt -- ddns set --file ./ddns-body.json
npm exec -w @javagt/reverse-proxy-client reverse-proxy-mgmt -- ddns clear
npm exec -w @javagt/reverse-proxy-client reverse-proxy-mgmt -- ddns sync
```

Flags: `--url`, `--db`, `--mode auto|http|db`, `--json`, `--file` (JSON bodies for `domains set` / `reserve` / `scan` / `ddns set`). Environment: `MANAGEMENT_URL`, `SQLITE_DB_PATH`.

**DDNS:** `ddns get` is read-only over HTTP. `ddns set`, `ddns sync`, and `ddns clear` hit the management server on localhost (same rules as `PUT` / `DELETE /api/v1/ddns` and `POST /api/v1/ddns/sync`: loopback needs no session; non-loopback needs a session cookie). `ddns sync` is HTTP-only. In `--mode db`, stop the proxy before `ddns set` or `ddns clear`.

## License

ISC (same as parent project).
