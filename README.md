# reverse-proxy

A lightweight, self-hosted HTTPS reverse proxy for routing subdomains to local services. Routes are registered via a localhost-only management API and persisted across restarts. The proxy core uses native Node.js `http` and `net` primitives — no third-party proxy libraries. Built with Clean Architecture, DDD, and TDD principles.

## Overview

- Listens on **port 443** (HTTPS) and routes requests by hostname to registered local services.
- Listens on **port 80** and redirects all HTTP traffic to HTTPS.
- Provides a **versioned management API** (localhost only) for dynamic routing.
- **Persistence**: Routes survive restarts via a secure JSON cache.
- **Zero-Downtime**: Automatic TLS certificate reloads.
- **Security**: Mandatory local-only access and optional Bearer token authentication.
- **IP Allowlisting**: Detailed access control per-route.
- **WebSockets**: Native support via raw TCP tunneling.

## Project Structure

This project follows a **Clean DDD Hexagonal** architecture.

```text
src/
├── domain/            # Core logic (RouteRegistry)
├── application/       # Orchestration logic (if any)
├── infrastructure/    # Adapters (HTTP, Persistence, TLS)
├── shared/            # Cross-cutting utilities
└── api/               # API Controllers
tests/                 # Unit and Integration tests
```

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your values

# Create a secret token file (recommended)
echo "$(openssl rand -hex 32)" | sudo tee /etc/reverse-proxy/secret
sudo chmod 600 /etc/reverse-proxy/secret
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TLS_CERT_DIR` | ✅ | — | Path to directory containing `privkey.pem` and `fullchain.pem` |
| `ROOT_DOMAIN` | | `javagrant.ac.nz` | Base domain for all subdomains |
| `ROUTE_CACHE_FILE` | | `./route-cache.json` | Path to the persistent route cache |
| `MANAGEMENT_SUBDOMAIN` | | `reverse-proxy` | Subdomain for the management API |
| `MANAGEMENT_SECRET_FILE` | ⚠️ | *(unset)* | Path to file containing the bearer token for API auth. |

---

## Management API (v1)

The management API is located at `http://<MANAGEMENT_SUBDOMAIN>.<ROOT_DOMAIN>/api/v1`. 

> [!IMPORTANT]
> **Host Constraint**: All management requests **MUST** originate from `localhost` (127.0.0.1 / ::1). Requests from any other IP will return `403 Forbidden`.

### Global Response Format

All successful responses are wrapped in a `data` envelope.

```json
{
  "data": { ... }
}
```

Errors are wrapped in an `error` envelope.

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

### Authentication

Protected endpoints require an `Authorization: Bearer <token>` header if `MANAGEMENT_SECRET_FILE` is configured.

### Endpoints

#### `GET /api/v1/health`
Verify the status of the management interface.

- **Status**: `200 OK`
- **Response**: `{ "data": { "status": "OK" } }`

#### `GET /api/v1/routes`
List all currently registered routes.

- **Status**: `200 OK`
- **Response**:
  ```json
  {
    "data": [
      { 
        "host": "myapp.example.com", 
        "target": "http://localhost:3000", 
        "type": "persistent",
        "options": { "allowlist": ["1.1.1.1"] }
      }
    ]
  }
  ```

#### `POST /api/v1/reserve`
Register a new subdomain mapping. Substitutes any existing route for the same host.

- **Status**: `201 Created`
- **Request Body**:
  ```json
  {
    "subdomain": "myapp",
    "port": 3000,
    "options": {
      "allowlist": ["127.0.0.1", "192.168.1.5"]
    }
  }
  ```
- **Response**: `{ "data": { "host": "myapp.domain.com", "target": "http://localhost:3000", ... } }`

#### `DELETE /api/v1/reserve/:subdomain`
Release a previously reserved route.

- **Status**: `200 OK`
- **Response**: `{ "data": { "host": "myapp.domain.com", "target": "..." } }`

---

## Error Codes Reference

| Code | Description | HTTP Status |
|---|---|---|
| `UNAUTHORIZED` | Bearer token missing or incorrect | 401 |
| `FORBIDDEN` | Request not from localhost | 403 |
| `NOT_FOUND` | Resource (subdomain) not found | 404 |
| `RESERVATION_FAILED` | Target port invalid or host reserved | 400 |
| `TOO_MANY_REQUESTS` | Rate limit exceeded | 429 |
| `SERVICE_UNAVAILABLE` | Token file unreadable | 503 |

## Verification & Testing

```bash
# Run unit tests
node tests/unit/RouteRegistry.test.mjs

# Run integration tests
node tests/integration/ProxyService.integration.test.mjs

# Check for unused code
npx knip
```
