# CLAUDE.md — context for AI-assisted development

This file summarizes how the **reverse-proxy** repo is structured, how it boots, and where to change behavior. Prefer the canonical **[README.md](README.md)** for user-facing setup; use this for implementation navigation.

## What this project is

- **Data plane:** Node.js **HTTPS (443)** and **HTTP→HTTPS redirect (80)** reverse proxy. Routing is by `Host` header; upstreams are local HTTP targets (multi-target / round-robin + health checks). Implemented with **`node:http`** / **`node:net`** — no third-party HTTP proxy library.
- **Control plane:** **Management API + static UI** on **127.0.0.1** only (default port **24789**, `MANAGEMENT_INTERFACE_PORT`). Same Express app also registers an **ephemeral HTTPS route** so the UI/API is reachable at `https://<MANAGEMENT_SUBDOMAIN>.<apex>/` through the data plane.
- **Persistence:** **SQLite** via **`node:sqlite`** (`DatabaseSync`) — routes, apex/domain config, DDNS config, sparse server settings, etc.

**Runtime:** Node.js **≥ 22.5.0** (required for `node:sqlite`). **ESM only** (`"type": "module"`, `.mjs` sources).

## Monorepo layout

| Path | Role |
|------|------|
| **[server.mjs](server.mjs)** | Composition root: TLS, proxy, health checks, management server, DDNS scheduler, signal handling. |
| **[src/domain/](src/domain/)** | **RouteRegistry** — in-memory routes, apex sets, reservation rules, ephemeral management host tracking. |
| **[src/infrastructure/](src/infrastructure/)** | **ProxyService**, **ManagementServer** (Express), **SqlitePersistence**, **TlsService**, **HealthCheckService**, static UI under `http/ui/`, DNS console helpers, network status. |
| **[src/api/](src/api/)** | **ManagementController** (route handlers), **reservationOps**, **managementAccounts**, **managementErrorResolutions**, **openapi.yaml**, **llms.txt**. |
| **[src/ddns/](src/ddns/)** | Porkbun DDNS: use cases, scheduler, adapters (HTTP IP lookup, SQLite cache). |
| **[src/config/](src/config/)** | **applyServerSettingsToEnv** (load `.env` + merge SQLite `server_settings`), **serverSettingsRegistry**, **validateServerSettingsPut**. |
| **[src/shared/](src/shared/)** | **Logger** (pino), **JsonError**, **RequestUtils** (loopback / local operator detection), **ReserveOptions**, scanners, etc. |
| **[src/management/](src/management/)** | **bootstrapFromPersistence** — builds **RouteRegistry** from SQLite + env. |
| **[packages/reverse-proxy-client/](packages/reverse-proxy-client/)** | Published **`@javagt/reverse-proxy-client`**: HTTP/SQLite clients, **`reverse-proxy-mgmt`** CLI. |
| **[tests/](tests/)** | **`node --test`**: `tests/unit/*.mjs`, `tests/integration/*.mjs`; workspace client tests under `packages/reverse-proxy-client/tests/`. |

## Boot order (critical)

1. **`server.mjs` imports `./src/config/applyServerSettingsToEnv.mjs` first** — loads `.env` via `process.loadEnvFile`, opens SQLite at `SQLITE_DB_PATH`, merges sparse **`meta.server_settings`** into **`process.env`** (see `serverSettingsRegistry.mjs`).
2. **`SqlitePersistence`**, **`hydrateRegistryFromPersistence`** — construct **RouteRegistry** (apex list from SQLite `root_domains` if present, else `ROOT_DOMAINS` / defaults).
3. **ManagementController** — receives registry, persistence, logger, public URL prefix options, optional **`onRootDomainsUpdated`** callback to refresh the management ephemeral route.
4. **ManagementServer** — Express app: rate limits, **@javagt/express-easy-auth** (sessions, passkeys/WebAuthn, optional registration secret), API wiring to controller, static UI.
5. **TlsService.start**, **HealthCheckService.start**, **managementServer.start**, **startDdnsScheduler**.
6. **HTTP redirect server (80)** and **HTTPS proxy (443)** with **SNICallback** using **`tlsService.secureContext`** (single cert context — multi-apex needs a cert SAN covering all zones).

After **PUT** operations that change persisted settings, code may call **`reapplyServerSettingsFromPersistence`** to reload `.env` baseline and re-apply SQLite overrides.

## Management API contract

- **Success:** `{ "data": ... }`
- **Errors:** `{ "error": { "code", "message", "details", "resolution" } }` — use **`sendJsonError`** / **`sendApiError`** patterns; human-readable **`resolution`** strings live in **`src/api/managementErrorResolutions.mjs`** and should stay aligned with **OpenAPI**.
- **Docs:** **`src/api/openapi.yaml`**, served at **`GET /api/v1/openapi.yaml`** and **`GET /openapi.yaml`**. **`src/api/llms.txt`** and **`GET /llms.txt`** are integration-oriented notes (including client usage).

## Authentication and access

- **Bind:** Management HTTP server listens on **127.0.0.1** only. Non-loopback clients get **403 FORBIDDEN** unless the request is considered “local” per **`RequestUtils`** (forwarded headers, optional **`MANAGEMENT_LOCAL_OPERATOR_IPS`**, optional cached public egress IP — see code and env comments).
- **Sessions:** **`@javagt/express-easy-auth`** at **`/api/v1/auth`**. Non-loopback callers need a session (**`mgmt.sid`**) after login (**`/login.html`** or API). Loopback often skips login.
- **WebAuthn:** Dynamic RP ID / origin handling in **`src/infrastructure/http/managementWebAuthnDynamic.mjs`**; trust proxy via **`MANAGEMENT_TRUST_PROXY`** when TLS terminates in front of Express.

## Domain and routing model

- **RouteRegistry** holds **persistent** routes (SQLite-backed) and **ephemeral** routes (e.g. management UI host). **`subdomain` + `baseDomain`** reservations map to FQDNs; **`baseDomain`** must be in the configured apex set.
- **ProxyService** resolves route → target (LB / health), forwards headers, supports **WebSocket upgrade**.
- **HealthCheckService** periodically probes **`options.healthPath`** and marks targets healthy/unhealthy.

## SQLite (conceptual)

- **`routes`:** `host`, `targets_json`, `options_json`, `manual`, etc.
- **`meta`:** keys such as **`ddns`**, **`server_settings`**, root domain / DNS console config — see **`SqlitePersistence.mjs`** for authoritative schema and accessors.

## Management UI

- Static HTML (**`index.html`**, **`login.html`**, **`register.html`**, **`settings.html`**, **`ddns.html`**, **`accounts.html`**, …) plus **native custom elements** (`rp-*` components) and small **`mgmt-*.mjs`** modules (theme, session, theme, help). **Not** React/Vue/Svelte — keep consistency with existing patterns when editing.

## Client package

- **`@javagt/reverse-proxy-client`** — **`createHttpClient`**, **`createAutoClient`**, **`createDbClient`**, **`ManagementApiError`**, bin **`reverse-proxy-mgmt`**. Tests live in **`packages/reverse-proxy-client/tests/`**. Version and exports: **`packages/reverse-proxy-client/package.json`**.

## Commands

```bash
npm install          # root + workspaces
npm start            # node server.mjs
npm test             # node --test unit + integration + client tests
npm run setup:env    # scripts/setup-env.mjs — interactive/env helper
```

## Conventions (codebase)

- **ESM** imports with **`.mjs`** extensions in source.
- **Private class fields** (`#`) for encapsulation where used.
- **Logging:** **`src/shared/utils/Logger.mjs`** (pino); structured objects + message strings.
- **Errors:** Stable **`code`** strings for API consumers; update OpenAPI and **`managementErrorResolutions`** when adding codes.

## Files to read first when changing behavior

| Topic | Start here |
|-------|------------|
| Process lifecycle / ports | [server.mjs](server.mjs) |
| Config merge (.env + SQLite) | [src/config/applyServerSettingsToEnv.mjs](src/config/applyServerSettingsToEnv.mjs), [src/config/serverSettingsRegistry.mjs](src/config/serverSettingsRegistry.mjs) |
| Express + auth + static UI | [src/infrastructure/http/ManagementServer.mjs](src/infrastructure/http/ManagementServer.mjs) |
| REST handlers | [src/api/ManagementController.mjs](src/api/ManagementController.mjs) |
| Routing / reservations | [src/domain/RouteRegistry.mjs](src/domain/RouteRegistry.mjs), [src/api/reservationOps.mjs](src/api/reservationOps.mjs) |
| Proxying | [src/infrastructure/http/ProxyService.mjs](src/infrastructure/http/ProxyService.mjs) |
| DB | [src/infrastructure/persistence/SqlitePersistence.mjs](src/infrastructure/persistence/SqlitePersistence.mjs) |
| Bootstrap | [src/management/bootstrapFromPersistence.mjs](src/management/bootstrapFromPersistence.mjs) |

## Audit notes (maintainers)

- **TLS:** `TLS_CERT_DIR` is required for the data plane to start (see **server.mjs**); some settings may also be persisted — follow **README** / Settings API.
- **Single TLS context:** Multiple apex domains need a certificate valid for all served names (SAN or wildcard).
- **Shutdown:** [server.mjs](server.mjs) implements graceful close; inspect that path when changing lifecycle. If you see **localhost debug ingest** `fetch` calls in the shutdown handler, treat them as **non-production instrumentation** — remove or gate behind an env flag before shipping a clean release.

When in doubt, cross-check behavior against **`src/api/openapi.yaml`** and **`npm test`**.
