# Reverse Proxy

A personal production reverse proxy that routes HTTP and WebSocket traffic to locally-registered backend services based on hostname. Runs on a single machine and is managed via an API-key-authenticated control plane.

## Language

**Service**:
A backend application that registers itself with the proxy to receive traffic.
_Avoid_: Microservice, worker, process

**Subdomain**:
The leftmost label of a `Host` header (e.g. `foo` from `foo.javagrant.ac.nz`). Used as a backward-compatible routing key.

**Service Registry**:
The in-memory index that maps Service hostnames to their active endpoints.

**Heartbeat Service**:
A Service that commits to sending periodic Heartbeats. If its Heartbeats stop arriving, the Service is considered stale and may be evicted or overwritten by a new registration.

**Permaclaim Service**:
A Service that does NOT use Heartbeats. Its Subdomain is held permanently until it explicitly deregisters. It will never be evicted by the cleanup task or overwritten by another registration.

**Heartbeat**:
A periodic HTTP request from a Heartbeat Service to the proxy confirming it is still alive. Heartbeat Services that miss their heartbeat window are considered stale and removed.

**Stale**:
A Heartbeat Service whose `lastHeartbeat` timestamp is older than the TTL threshold. Stale Services are eligible for eviction by the cleanup task and for overwrite by a new registration.

**Control Plane**:
The set of API endpoints (`/register`, `/heartbeat`, `/deregister`, `/services`) used to manage the Service Registry. Authenticated via API key.

## Relationships

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
