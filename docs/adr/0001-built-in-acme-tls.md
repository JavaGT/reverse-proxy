# Use in-app ACME TLS instead of a separate reverse proxy

The proxy currently runs HTTP-only on port 80, but serves production traffic on the public internet (single machine, personal use). It needs HTTPS with valid certificates for `*.javagrant.ac.nz`.

We will implement ACME (Let's Encrypt) auto-renewal directly inside the proxy application rather than placing Caddy, nginx, or another TLS-terminating reverse proxy in front.

The proxy will handle both HTTP (port 80, for ACME HTTP-01 challenges and plaintext traffic) and HTTPS (port 443). Certificate renewal runs as a background task with automatic reload.

- **Status**: accepted

## Considered options

1. **Caddy in front** — Caddy on :443 ACME-proxies to this proxy on :80. Simplest to set up, but adds a dependency and another moving part to a single-machine setup.
2. **Manual certs + native Fastify HTTPS** — generate certs externally (acme.sh, certbot), feed key paths to Fastify. Cert renewal is external, requires a process restart or file-watch reload.
3. **In-app ACME** — the proxy handles its own certificate lifecycle. Self-contained, no external processes for TLS.

## Consequences

- Adds ACME client dependency (`acme-client`, `greenlock`, or similar)
- DNS-01 challenge needed for wildcard cert (`*.javagrant.ac.nz`) — requires DNS provider API credentials
- Renewal before expiry (±30 days) must be reliable and logged
- Certificate rotation requires a zero-downtime swap (update Fastify's HTTPS options, not a restart)
