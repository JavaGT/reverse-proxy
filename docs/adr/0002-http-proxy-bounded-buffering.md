# Bounded buffering for HTTP proxied responses (cap-then-stream)

Upstream responses from registered backends are proxied over HTTP. Unbounded buffering risks memory spikes and OOM on large bodies; pure streaming-first minimizes memory but complicates header handling, error recovery, and small-response optimizations.

**Decision**: For proxied HTTP responses, use **bounded buffering**: accumulate response bytes up to a modest, fixed cap, then **stream** any remainder. Behavior is predictable (small responses fully materialized within the cap; large responses transition to streaming), and edge cases stay simpler than a streaming-only path.

- **Status**: accepted

## Considered options

1. **Full buffer** — read the entire upstream body into memory before sending to the client. Simplest to reason about for headers and errors, but worst-case memory is proportional to response size and can exhaust the process.
2. **Stream-first** — pipe the upstream body to the client with minimal or no buffering. Lowest steady-state memory, but more branches (streaming vs non-streaming), trickier interaction with response headers and client disconnects, and harder guarantees for small payloads.
3. **Cap-then-stream (chosen)** — buffer up to a fixed cap, then stream the rest. Caps worst-case buffering, keeps small responses on a familiar “buffer then send” path, and defers streaming complexity to bodies larger than the cap.

## Consequences

- Memory use for a single proxied response is bounded by the cap plus whatever the streaming path holds in flight.
- Implementation must define the cap explicitly and document it for operators and SDK users.
- Responses at or below the cap behave like buffered responses; above the cap, clients see chunked/streamed delivery consistent with the streaming segment.
- Tests should cover sub-cap, at-cap, and over-cap bodies plus client abort mid-stream.
