# @javagt/reverse-proxy-client

This package is published on **[npm](https://www.npmjs.com/package/@javagt/reverse-proxy-client)** as **`@javagt/reverse-proxy-client`**; source code lives in the **[reverse-proxy](https://github.com/JavaGT/reverse-proxy)** repo under [`packages/reverse-proxy-client`](https://github.com/JavaGT/reverse-proxy/tree/main/packages/reverse-proxy-client). It is a programmatic client and CLI for the reverse-proxy **management API** (`/api/v1/...` on `127.0.0.1`) and optional **SQLite** access when the server is down. The server serves integration notes at **`GET /llms.txt`** (includes this package) and machine-readable **`GET /api/v1/openapi.yaml`**.

## Install

**From npm (any project):**

```bash
npm install @javagt/reverse-proxy-client
```

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

The proxy listens on **`127.0.0.1`**; the port is configured in SQLite (**`managementInterfacePort`**, default **24789**). Pass an explicit `baseUrl` to the HTTP client.

- **CLI:** uses `--url` if set, else `http://127.0.0.1:24789`.
- **Library:** pass the URL your server is bound to, for example:

```js
const baseUrl = "http://127.0.0.1:24789";

const http = createHttpClient({ baseUrl });
```

Use the same port as **`managementInterfacePort`** in the server’s Settings so co-located tools stay in sync when it is changed.

### DDNS and offline behavior (details)

- The management server builds multi-job DDNS summaries with one apex list and DNS-console/env snapshot per response (see **`snapshotDdnsResolveContext`** in the main repo’s **`src/ddns/ddnsConfigResolve.mjs`**). That keeps job rows consistent within a single `GET` without re-reading settings per job.
- **`createDbClient({ dbPath })`** without **`env`**: merges sparse **`meta.server_settings`** from SQLite with the same defaults the server uses, so offline calls align with persisted **`managementInterfacePort`** and related settings.
- SQLite DDNS reads (`getDdns`, `putDdns`, `deleteDdns`) attach **`cachedPublicIp`**, **`cachedPublicIpByJob`**, and **`lastRun`** when the DB is available. If reading the per-job IP cache from **`meta` fails, the response still succeeds**; a one-line message may be printed to **stderr** for diagnostics (`[@javagt/reverse-proxy-client] DDNS cached IP read failed (non-fatal): …`).

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

const baseUrl = "http://127.0.0.1:24789";

const http = createHttpClient({
    baseUrl
});

const { data: routes } = await http.getRoutes();

const db = createDbClient({
    dbPath: "./reverse-proxy.db"
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
# optional: --job <jobId> to sync a single DDNS job
```

Flags: `--url`, `--db`, `--mode auto|http|db`, `--json`, `--file` (JSON bodies for `domains set` / `reserve` / `scan` / `ddns set`). Defaults: `--url http://127.0.0.1:24789`, `--db ./reverse-proxy.db`.

**DDNS:** `ddns get` is read-only over HTTP. `ddns set`, `ddns sync`, and `ddns clear` hit the management server on localhost (same rules as `PUT` / `DELETE /api/v1/ddns` and `POST /api/v1/ddns/sync`: loopback needs no session; non-loopback needs a session cookie). `ddns sync` is HTTP-only. In `--mode db`, stop the proxy before `ddns set` or `ddns clear`.

## License

ISC (same as parent project).
