# reverse-proxy

A lightweight, self-hosted HTTPS reverse proxy for routing hostnames to local services. Routes are registered via a localhost-only management API and persisted in SQLite. The proxy uses Node.js `http` and `net` only (no third-party proxy stack). The codebase follows layered boundaries (domain, infrastructure, API) and ships with tests. Integrations can use the official **`@javagt/reverse-proxy-client`** package ([npm](https://www.npmjs.com/package/@javagt/reverse-proxy-client), [source](packages/reverse-proxy-client/README.md)) for HTTP, optional SQLite fallback, and the **`reverse-proxy-mgmt`** CLI.

**Requirements:** Node.js **22.5+** (uses built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html)).

## Quick start

1. **Install and first-run settings**

   ```bash
   npm install
   npm run setup:env
   ```

   The setup script writes **`tlsCertDir`**, **`rootDomains`**, and a **`managementSessionSecret`** into SQLite (`./reverse-proxy.db` in the project root). You can instead use **`/settings.html`** after a manual first start if you seed **`meta.server_settings`** yourself. Non-loopback access uses **`@javagt/express-easy-auth`** sessions at **`/api/v1/auth`** (sign in at **`/login.html`**). **Loopback** may call the API and UI without signing in.

2. **Run** — from the repo root:

   ```bash
   npm start
   ```

   The proxy listens on **443** (HTTPS) and **80** (redirect to HTTPS). On Unix-like systems those ports are often privileged; you may need **`sudo`** (or equivalent) for the process to bind successfully.

3. **Check the management API** — the management HTTP server listens on **127.0.0.1** only (default port **24789**, overridable in Settings as **`managementInterfacePort`**):

   ```bash
   curl -sS "http://127.0.0.1:24789/api/v1/health"
   ```

4. **Next steps** — open the management UI in a browser on the same host (or via SSH port-forward to `127.0.0.1`), register routes with **`POST /api/v1/reserve`** (see [Management API](#management-api-v1) below), or use the CLI in [packages/reverse-proxy-client/README.md](packages/reverse-proxy-client/README.md).

5. **Reserve a subdomain from Node.js** — add **`@javagt/reverse-proxy-client`** to your app (Node **22.5+**, ESM). From npm: `npm install @javagt/reverse-proxy-client`. From another checkout without publishing, install by path (adjust to your tree):

   ```bash
   npm install @javagt/reverse-proxy-client@file:../reverse-proxy/packages/reverse-proxy-client
   ```

   Use `createHttpClient` with the same base URL as the management listener (default **`http://127.0.0.1:24789`**). From **loopback**, no session cookie is required. From elsewhere you must reuse a **`mgmt.sid`** session (Node does not do this automatically—use port-forward to loopback or implement login and pass `Cookie` on `fetch`). The script must reach **`http://127.0.0.1:<port>`** (or port-forward to loopback).

   ```js
   import { createHttpClient } from "@javagt/reverse-proxy-client";

   const baseUrl = "http://127.0.0.1:24789";

   const http = createHttpClient({
       baseUrl
   });

   const { data } = await http.reserve({
       subdomain: "myapp",
       baseDomain: "example.com",
       port: 3000
   });
   ```

   `baseDomain` must be one of the server’s configured apex zones; you can also pass **`ports`**, **`targets`**, or **`options`** (see [Notable endpoints](#notable-endpoints) and [packages/reverse-proxy-client/README.md](packages/reverse-proxy-client/README.md)).

Further setup: **[Setup](#setup)** and **[Server settings](#server-settings-sqlite)** below.

## Overview

- Listens on **443** (HTTPS) and routes by `Host` to registered upstreams (HTTP to localhost ports, with optional health checks and round-robin across targets).
- Listens on **80** and redirects to HTTPS.
- **Management API** on a dedicated host (ephemeral route when the data plane is up), bound to **127.0.0.1** only — use SSH port-forward or equivalent to reach it. If **TLS** is not configured or cert files cannot be loaded, the process still starts: **only** the loopback management API/UI runs so you can set **`tlsCertDir`** in Settings (or **`TLS_CERT_DIR`**) and restart; ports **80**/**443** stay closed until then (`GET /api/v1/health` reports **`dataPlaneActive: false`**).
- **Persistence:** SQLite database at **`./reverse-proxy.db`** in the server working directory (run from the repo root, or align your cwd with where you keep the file).
- **Multi-domain:** Apex zones may be stored in **SQLite** via **`PUT /api/v1/domains`** (or the management UI); when present, that list overrides the default apex list from **`meta.server_settings`** / built-in defaults. Otherwise **`rootDomains`** in Settings (comma-separated) applies. Optional **`baseDomain`** on reserve and `?baseDomain=` on delete when more than one apex is configured.
- **TLS:** Reloads certificates from **`tlsCertDir`** (Settings / SQLite) without full process restart. With **multiple** apex zones, use one certificate whose **Subject Alternative Name (SAN)** lists every apex (or a wildcard) you serve; the listener uses a single cert context, so a cert valid for only one zone will trigger browser warnings on the others.
- **Optional DDNS:** Porkbun API integration on an interval; settings live in SQLite (`meta.ddns`) and are edited via the management UI, **`PUT /api/v1/ddns`**, or the **`reverse-proxy-mgmt ddns`** CLI — not via environment variables.
- **Web UI:** Single-page wiki-style dashboard (static assets + web components) for routes, reserve form, and port scan.

## Project layout

```text
src/
├── domain/              # RouteRegistry (routing, reservation rules)
├── ddns/                # Porkbun DDNS (models, SyncService, use case, adapters, scheduler)
├── infrastructure/    # HTTP (proxy, management, health), TLS, SQLite persistence, UI static files
├── shared/              # Logging, JSON errors, reserve options validation, etc.
├── api/                 # Management controller, OpenAPI YAML, llms.txt
packages/
└── reverse-proxy-client/  # @javagt/reverse-proxy-client — HTTP + SQLite clients, reverse-proxy-mgmt CLI
tests/                   # Unit and integration tests
server.mjs               # Composition root
```

## Setup

```bash
npm install
npm run setup:env
```

`setup:env` interactively seeds **`./reverse-proxy.db`** (`meta.server_settings`: **`tlsCertDir`**, **`rootDomains`**, **`managementSessionSecret`**, optional invite secret). Start the server from the **same directory** so it opens that database path.

### Server settings (SQLite)

All tunables live in **`meta.server_settings`** (camelCase keys) with built-in defaults; edit via **`GET`/`PUT /api/v1/settings`** or **`/settings.html`**. Examples: **`tlsCertDir`**, **`rootDomains`**, **`managementInterfacePort`**, **`managementSessionSecret`**, **`managementRateLimitMax`**, **`healthCheckIntervalMs`**, **`dnsConsoleDefaultProvider`**, probe timeouts. See **`GET /api/v1/openapi.yaml`** for the full list. **`PUT /api/v1/settings`** requires localhost TCP (and a session when not same-machine); some keys still need a process restart to apply everywhere.

**`.env`:** On startup, the process loads **`.env`** (if present) before merging SQLite. **`TLS_CERT_DIR`** and **`MANAGEMENT_SESSION_SECRET`** are applied from the environment when those keys are **not** stored in SQLite (if a key exists in SQLite, it wins). Copy **`.env.example`** as a template.

## Management API (v1)

Base URL pattern: `http://127.0.0.1:<port>/api/v1` (default port **24789**, overridable via Settings **`managementInterfacePort`**; the management app also registers `https://<managementSubdomain>.<apex>/` in the route table for the data plane).

**Official client:** Use **`@javagt/reverse-proxy-client`** ([npm](https://www.npmjs.com/package/@javagt/reverse-proxy-client), [README](packages/reverse-proxy-client/README.md)) for typed-style helpers (`createHttpClient`, `createAutoClient`, `createDbClient`), **`ManagementApiError`**, and the **`reverse-proxy-mgmt`** CLI instead of hand-rolling `fetch`. Human and LLM-oriented notes also cover the client in **`GET /llms.txt`**.

**Localhost only:** Requests must come from loopback; otherwise **`403`** with `FORBIDDEN`.

**Rate limit:** Global per listener (default **300** requests per **60s**; tune **`managementRateLimitMax`** / **`managementRateLimitWindowMs`** in Settings).

### Response shapes

Success:

```json
{ "data": { ... } }
```

Errors (stable shape):

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human-readable message",
    "details": null,
    "resolution": "What to try next (see OpenAPI for full list of codes)"
  }
}
```

`resolution` is included on every management JSON error to speed up fixes (auth, missing `baseDomain`, rate limits, etc.). `details` may be an object or array when provided (for example conflict `host` / `reason`).

### Authentication

**`@javagt/express-easy-auth`** at **`/api/v1/auth`** provides sessions (password, TOTP, passkeys). **Non-loopback** clients must sign in (browser **`/login.html`** or `POST /api/v1/auth/login` with a cookie-aware client); the session cookie applies to the static UI and all **`/api/v1/*`** routes. **Loopback** clients need no credentials.

**Passkeys (WebAuthn):** For each request, `rpID` and `origin` follow the browser’s **`Host`** (and **`X-Forwarded-Proto`** when present), so signing in at `https://reverse-proxy.example.com` uses that hostname instead of a fixed `localhost` value. Loopback addresses still use **`rpID` = `localhost`**. If you terminate TLS in front of the management app, set **`managementTrustProxy`** to **`1`** in Settings so Express sees the correct scheme. Credentials are **per hostname** (a passkey created on `127.0.0.1` is not the same WebAuthn credential as on your public management hostname). For a **non-loopback IP** in `Host`, WebAuthn falls back to **`managementAuthRpId`** / **`managementBaseDomain`**.

### Notable endpoints

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/v1/health` or `/api/v1/status` | Control plane liveness |
| `GET` | `/api/v1/domains` | `{ primary, apexDomains[] }` |
| `PUT` | `/api/v1/domains` | Body `{ apexDomains: string[] }` — replace list in SQLite (first = primary); existing routes must stay valid |
| `GET` | `/api/v1/routes` | Routes include `publicUrl`, `baseDomain`, `targets[]`, etc. |
| `GET` | `/api/v1/network` | Local IPs, public IP snapshot, DNS for apex + wildcard probe rows only |
| `POST` | `/api/v1/reserve` | Body: **`subdomain`**, **`baseDomain`**, ports or `targets`, optional `options`. Or **`reservations`**: array of the same shape for batch (multiple apexes in one request). Same mapping repeated returns **200** (idempotent); new or replaced mapping **201**; conflict **409** `SUBDOMAIN_CONFLICT`. |
| `DELETE` | `/api/v1/reserve/:subdomain` | Query **`baseDomain`** (required): apex for the mapping to release. |
| `POST` | `/api/v1/scan` | JSON body optional: `start`, `end` (inclusive; `end - start` must be 1–10000), `concurrency` — list open ports and processes |
| `DELETE` | `/api/v1/process/:port` | Terminate listener on TCP port (localhost; non-loopback needs session) |
| `GET` | `/api/v1/openapi.yaml` or `/openapi.yaml` | Same OpenAPI 3 document (use for codegen) |
| `GET` | `/llms.txt` | Human-oriented integration notes for tools (includes **`@javagt/reverse-proxy-client`**) |

Full detail: **`GET /api/v1/openapi.yaml`** (or root **`GET /openapi.yaml`**) and **`src/api/llms.txt`**. Programmatic access: **`@javagt/reverse-proxy-client`** ([packages/reverse-proxy-client/README.md](packages/reverse-proxy-client/README.md)).

### Error codes (selection)

| Code | Typical HTTP |
|------|----------------|
| `UNAUTHORIZED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `SUBDOMAIN_CONFLICT` | 409 |
| `INVALID_REQUEST` / `INVALID_HEALTH_PATH` / `DOMAIN_CONFLICT` | 400 |
| `TOO_MANY_REQUESTS` | 429 |
| `SERVICE_UNAVAILABLE` | 503 |
| `PERSISTENCE_FAILED` | 500 |

## Web UI

Open the management server root in a browser (via port-forward). The interface is a single page with a table of contents (`#overview`, `#domains`, `#routes`, `#scanner`, `#api`), data tables for routes and scan results, and native **custom elements** (`rp-domains-summary`, `rp-routes-panel`, `rp-reserve-form`, `rp-scan-panel`). Styling aims for a readable, content-first layout (wiki-like).

## Verification and tests

```bash
npm test
```

