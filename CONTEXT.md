# Reverse Proxy

A personal production reverse proxy that routes HTTP and WebSocket traffic to locally-registered backend services based on hostname. Runs on a single machine and is managed via an API-key-authenticated control plane.

## Language

**Service**:
A backend application that registers itself with the proxy to receive traffic.
_Avoid_: Microservice, worker, process

**Subdomain**:
The leftmost label of a `Host` header (e.g. `foo` from `foo.javagrant.ac.nz`). Used as a backward-compatible routing key.

**Single process operation**:
Exactly one proxy process owns the **Service Registry** at a time. Conflict rules, Heartbeat semantics, and durability guarantees in this document assume this mode—no peer writers, no split authority over the same directory.

**Clustered operation**:
Multiple proxy processes acting as peers over one logical **Service Registry**. This product does not target clustered operation; supersession, staleness, and durability would need a different model than the one documented here.

**Service Registry**:
The authoritative directory that maps routing keys to their active **Services**. The proxy reads it to decide where traffic goes. Under **Single process operation**, directory state is **durable across restarts** (a bounce does not imply an empty directory). Under **Clustered operation**, the statements in this document do not apply.

**Heartbeat Service**:
A Service that commits to sending periodic Heartbeats. While its claim for a routing key is non-stale, the registry rejects a second registration for that same key. If its Heartbeats stop arriving, the Service is considered stale and may be evicted or overwritten by a new registration.

**Permaclaim Service**:
A Service that does NOT use Heartbeats. Its Subdomain is held permanently until it explicitly deregisters. It will never be evicted by the cleanup task or overwritten by another registration; a superseding registration for the same routing key is rejected.

**Heartbeat**:
A periodic HTTP request from a Heartbeat Service to the proxy confirming it is still alive. Heartbeat Services that miss their heartbeat window are considered stale and removed.

**Stale**:
A Heartbeat Service whose `lastHeartbeat` timestamp is older than the TTL threshold. Stale Services are eligible for eviction by the cleanup task and for overwrite by a new registration.

**Non-stale**:
For a Heartbeat Service, not Stale for its routing key: Heartbeats are still arriving within the TTL window, so the registry considers that claim active.

**Registration conflict**:
The registry refuses a new registration because the routing key is already held under rules that forbid supersession.

- **Permaclaim Service** — Any later registration for the same routing key is rejected while the permaclaim stands.
- **Heartbeat Service** — A second registration for the same routing key is rejected while the existing Heartbeat Service is non-stale; once that claim is Stale, a new registration may take the key.

**Control Plane**:
The set of API endpoints (`/register`, `/heartbeat`, `/deregister`, `/services`) used to manage the Service Registry. Authenticated via API key.

## Relationships

- **Single process operation** is assumed unless explicitly noted otherwise; **Clustered operation** is out of scope for the current domain model.
- A **Service** registers itself under exactly one **Subdomain**
- The **Service Registry** maps **Subdomains** (or full **hostname** values) to **Services**
- A **Service** sends periodic **Heartbeats** to stay in the **Service Registry**
- The **Control Plane** manages entries in the **Service Registry**
- The **Proxy** reads the **Service Registry** to route incoming requests

## Example dialogue

> **Dev:** "If my **Service** crashes, will it be removed from the **Service Registry** automatically?"
> **Domain expert:** "Yes — the cleanup task runs every 5 seconds. Once the **Heartbeat** stops arriving, the **Service** goes stale and is evicted after 30 seconds."

> **Dev:** "Can I register a **Service** that never heartbeats — like a database admin panel that I want to stay up permanently?"
> **Domain expert:** "Yes — register with `heartbeat: false`. That's a **Permaclaim Service**. It will only be removed if you explicitly deregister it."

## Flagged ambiguities

(none — all previously flagged items have been resolved.)
