/**
 * Short, actionable hints for management API JSON errors (`error.resolution`).
 * Keep messages self-contained for CLI/LLM clients.
 */
const RESOLUTIONS = {
    UNAUTHORIZED:
        "Send header `Authorization: Bearer <secret>` where `<secret>` matches `MANAGEMENT_SECRET` on the server. If the env var is unset, mutating endpoints do not require a token.",
    FORBIDDEN:
        "The management API only accepts connections to 127.0.0.1. Use SSH local port forwarding (e.g. `ssh -L 24789:127.0.0.1:24789 host`) or run the client on the same machine.",
    NOT_FOUND:
        "Use paths documented under `/api/v1/` (see `GET /api/v1/openapi.yaml` or `GET /openapi.yaml`). Static UI is served at `/`; unknown JSON routes return this error.",
    NOT_IMPLEMENTED:
        "This deployment does not support the operation (for example DDNS settings persistence requires SQLite). Use the documented persistence mode or call another endpoint.",
    BAD_REQUEST:
        "Send a JSON object with `Content-Type: application/json`. Validate the body against the operation schema in OpenAPI.",
    TOO_MANY_REQUESTS:
        "Wait and retry, or raise `MANAGEMENT_RATE_LIMIT_MAX` / `MANAGEMENT_RATE_LIMIT_WINDOW_MS` in the server environment.",
    INTERNAL_SERVER_ERROR:
        "Check server logs for the stack trace. Retry after fixing configuration or data; if it persists, capture the request id from logs if present.",
    INVALID_REQUEST:
        "Compare your JSON body and query parameters with the schemas in OpenAPI (`GET /api/v1/openapi.yaml`). Common fixes: include `baseDomain` on reserve and on delete; use a configured apex from `GET /api/v1/domains`.",
    INVALID_HEALTH_PATH:
        "Set `options.healthPath` to a path starting with `/` (max 256 chars), no whitespace, no `//`. Omit `options` if you do not need upstream health probes.",
    DOMAIN_CONFLICT:
        "Every existing route must stay under one of the new apex domains. Release orphan routes with `DELETE /api/v1/reserve/:subdomain?baseDomain=...`, then retry `PUT /api/v1/domains`.",
    PERSISTENCE_FAILED:
        "Ensure `SQLITE_DB_PATH` is writable and the disk is not full. Inspect server logs for the underlying SQLite error.",
    SUBDOMAIN_CONFLICT:
        "The host is reserved or blocked while a health-checked route is healthy. Use another subdomain, release the route first, or wait until upstream probes mark targets unhealthy so replace is allowed.",
    RESERVATION_FAILED:
        "Fix subdomain (single DNS label), `baseDomain` (must be a listed apex), and one of `port` / `ports` / `target` / `targets` per OpenAPI `SingleReserveRequest`.",
    ROUTE_NOT_FOUND:
        "Nothing is registered for that subdomain on the given apex. List mappings with `GET /api/v1/routes` and pass the correct `baseDomain` query parameter.",
    RELEASE_FAILED:
        "Confirm `baseDomain` matches the route’s apex and the subdomain label is correct. Reserved management hostnames cannot be released.",
    INVALID_RANGE:
        "`POST /api/v1/scan` expects JSON `{ start, end }` with `1 <= (end - start) <= 10000` (inclusive range).",
    SCAN_FAILED:
        "See the error message; ensure the server can bind sockets for the scan and that start/end are valid ports (1–65535).",
    INVALID_PORT:
        "Use an integer TCP port 1–65535 in the path: `DELETE /api/v1/process/:port`.",
    PROCESS_NOT_FOUND:
        "No process was listening on that port when checked. Use `POST /api/v1/scan` to find open ports, or verify with OS tools.",
    KILL_FAILED:
        "The server could not signal the process (permissions or race). Check logs; you may need to stop the process manually on the host."
};

const FALLBACK =
    "See `GET /api/v1/openapi.yaml` or `GET /openapi.yaml` for all paths and schemas, and `GET /llms.txt` for integration notes (including the official npm client `@javagt/reverse-proxy-client`).";

/** @param {string | undefined | null} code */
export function resolutionForManagementError(code) {
    const c = String(code ?? "").trim();
    if (!c) return FALLBACK;
    return RESOLUTIONS[c] ?? FALLBACK;
}
