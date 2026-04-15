# reverse-proxy

A lightweight, self-hosted HTTPS reverse proxy for routing hostnames to local services. Routes are registered via a localhost-only management API and persisted in SQLite. The proxy uses Node.js `http` and `net` only (no third-party proxy stack). The codebase follows layered boundaries (domain, infrastructure, API) and ships with tests. Integrations can use the official **`@javagt/reverse-proxy-client`** package ([npm](https://www.npmjs.com/package/@javagt/reverse-proxy-client), [source](packages/reverse-proxy-client/README.md)) for HTTP, optional SQLite fallback, and the **`reverse-proxy-mgmt`** CLI.

**Requirements:** Node.js **22.5+** (uses built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html)).

## Quick start

1. **Install and env**

   ```bash
   npm install
   cp .env.example .env
   ```

   Edit `.env` and set at least **`TLS_CERT_DIR`** (a directory containing `privkey.pem` and `fullchain.pem`) and **`ROOT_DOMAINS`** (comma-separated apex hostnames). Non-loopback access uses **`@javagt/express-easy-auth`** sessions at **`/api/v1/auth`** (sign in at **`/login.html`**); set **`MANAGEMENT_SESSION_SECRET`** for cookie signing. **Loopback** may call the API and UI without signing in.

2. **Run** — from the repo root:

   ```bash
   npm start
   ```

   The proxy listens on **443** (HTTPS) and **80** (redirect to HTTPS). On Unix-like systems those ports are often privileged; you may need **`sudo`** (or equivalent) for the process to bind successfully.

3. **Check the management API** — the management HTTP server listens on **127.0.0.1** only (default port **24789**, overridable with `MANAGEMENT_INTERFACE_PORT`):

   ```bash
   curl -sS "http://127.0.0.1:24789/api/v1/health"
   ```

4. **Next steps** — open the management UI in a browser on the same host (or via SSH port-forward to `127.0.0.1`), register routes with **`POST /api/v1/reserve`** (see [Management API](#management-api-v1) below), or use the CLI in [packages/reverse-proxy-client/README.md](packages/reverse-proxy-client/README.md).

5. **Reserve a subdomain from Node.js** — add **`@javagt/reverse-proxy-client`** to your app (Node **22.5+**, ESM). From npm: `npm install @javagt/reverse-proxy-client`. From another checkout without publishing, install by path (adjust to your tree):

   ```bash
   npm install @javagt/reverse-proxy-client@file:../reverse-proxy/packages/reverse-proxy-client
   ```

   Use `createHttpClient` with the same **`MANAGEMENT_INTERFACE_PORT`** / **`MANAGEMENT_URL`**. From **loopback**, no session cookie is required. From elsewhere you must reuse a **`mgmt.sid`** session (Node does not do this automatically—use port-forward to loopback or implement login and pass `Cookie` on `fetch`). The script must reach **`http://127.0.0.1:<port>`** (or port-forward to loopback).

   ```js
   import { createHttpClient } from "@javagt/reverse-proxy-client";

   const baseUrl =
       process.env.MANAGEMENT_URL?.replace(/\/$/, "") ||
       `http://127.0.0.1:${process.env.MANAGEMENT_INTERFACE_PORT || "24789"}`;

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

Full variable list and one-time setup notes: **[Setup](#setup)** and **[Environment variables](#environment-variables-summary)** below.

## Overview

- Listens on **443** (HTTPS) and routes by `Host` to registered upstreams (HTTP to localhost ports, with optional health checks and round-robin across targets).
- Listens on **80** and redirects to HTTPS.
- **Management API** on a dedicated host (ephemeral route), bound to **127.0.0.1** only — use SSH port-forward or equivalent to reach it.
- **Persistence:** SQLite database (`SQLITE_DB_PATH`).
- **Multi-domain:** Apex zones may be stored in **SQLite** via **`PUT /api/v1/domains`** (or the management UI); when present, that list overrides **`ROOT_DOMAINS`** from the environment. Otherwise use comma-separated **`ROOT_DOMAINS`**. Optional **`baseDomain`** on reserve and `?baseDomain=` on delete when more than one apex is configured.
- **TLS:** Reloads certificates from `TLS_CERT_DIR` without full process restart. With **multiple** values in `ROOT_DOMAINS`, use one certificate whose **Subject Alternative Name (SAN)** lists every apex (or a wildcard) you serve; the listener uses a single cert context, so a cert valid for only one zone will trigger browser warnings on the others.
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
cp .env.example .env
# Edit .env: TLS_CERT_DIR, ROOT_DOMAINS, SQLITE_DB_PATH, etc.

# Recommended in production: session signing for express-easy-auth (set in .env, do not commit)
# MANAGEMENT_SESSION_SECRET=<output of: openssl rand -hex 32>
```

The server loads `.env` from the current working directory at startup (`process.loadEnvFile`). Alternatively you can inject env without runtime loading: `node --env-file=.env server.mjs` (Node 20.6+).

### Environment variables (summary)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TLS_CERT_DIR` | yes | — | Directory with `privkey.pem` and `fullchain.pem` |
| `ROOT_DOMAINS` | no | `javagrant.ac.nz` | Comma-separated apex hostnames (first = primary default); ignored at runtime if apex list exists in SQLite |
| `SQLITE_DB_PATH` | no | `./reverse-proxy.db` | SQLite file for routes and meta |
| `MANAGEMENT_SUBDOMAIN` | no | `reverse-proxy` | Label for management UI/API host |
| `MANAGEMENT_INTERFACE_PORT` | no | `24789` | Localhost port for the management HTTP server (`127.0.0.1`) |
| `MANAGEMENT_BASE_DOMAIN` | no | first `ROOT_DOMAINS` entry | Apex used for management hostname |
| `MANAGEMENT_SESSION_SECRET` | no (yes in prod) | dev default | Secret for management `express-session` cookies |
| `MANAGEMENT_RATE_LIMIT_MAX` | no | `300` | Max requests per window for the management HTTP API (global) |
| `MANAGEMENT_RATE_LIMIT_WINDOW_MS` | no | `60000` | Rate-limit window in milliseconds |
| `HEALTH_CHECK_INTERVAL_MS` | no | `30000` | Upstream health probe interval |
| `PUBLIC_URL_HTTPS_PREFIX` / `PUBLIC_URL_HTTP_PREFIX` | no | `https` / `http` | Schemes in `publicUrl` / `publicUrlHttp` in API responses |
| `DNS_CONSOLE_DEFAULT_PROVIDER` | no | — | Optional default for DNS management links (`porkbun`); overridden by SQLite `dnsConsole` from `PUT /api/v1/domains` |

## Management API (v1)

Base URL pattern: `http://127.0.0.1:<port>/api/v1` (default port **24789**, overridable with `MANAGEMENT_INTERFACE_PORT`; the management app also registers `https://<MANAGEMENT_SUBDOMAIN>.<MANAGEMENT_BASE_DOMAIN>/` in the route table for the data plane).

**Official client:** Use **`@javagt/reverse-proxy-client`** ([npm](https://www.npmjs.com/package/@javagt/reverse-proxy-client), [README](packages/reverse-proxy-client/README.md)) for typed-style helpers (`createHttpClient`, `createAutoClient`, `createDbClient`), **`ManagementApiError`**, and the **`reverse-proxy-mgmt`** CLI instead of hand-rolling `fetch`. Human and LLM-oriented notes also cover the client in **`GET /llms.txt`**.

**Localhost only:** Requests must come from loopback; otherwise **`403`** with `FORBIDDEN`.

**Rate limit:** Global per listener (default **300** requests per **60s**; set `MANAGEMENT_RATE_LIMIT_MAX` / `MANAGEMENT_RATE_LIMIT_WINDOW_MS` to tune).

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

**Passkeys (WebAuthn):** For each request, `rpID` and `origin` follow the browser’s **`Host`** (and **`X-Forwarded-Proto`** when present), so signing in at `https://reverse-proxy.example.com` uses that hostname instead of a fixed `localhost` value. Loopback addresses still use **`rpID` = `localhost`**. If you terminate TLS in front of the management app, set **`MANAGEMENT_TRUST_PROXY=1`** so Express sees the correct scheme. Credentials are **per hostname** (a passkey created on `127.0.0.1` is not the same WebAuthn credential as on your public management hostname). For a **non-loopback IP** in `Host`, WebAuthn falls back to **`MANAGEMENT_AUTH_RP_ID`** / **`MANAGEMENT_BASE_DOMAIN`**.

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

