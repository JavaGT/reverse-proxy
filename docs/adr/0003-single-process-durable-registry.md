# Durable Service Registry for single-process deployment

Today the **Service Registry** is effectively process-local: a restart drops all registrations until backends register again. That is acceptable for quick iteration but poor for operators who expect stable host routing across deploys and ordinary bounces. At the same time, the product is intentionally a single-machine, personal-production tool—not a horizontally scaled edge.

**Decision**: Treat the registry as a **single-writer, durable directory** for **single process operation** only. One proxy instance owns the persisted state; on restart it reloads that state rather than starting from an empty directory. **Clustered operation** (multiple peers, shared logical registry, HA) is explicitly deferred: it would require consensus, leader election, or an external store, plus new conflict and heartbeat semantics.

- **Status**: accepted

## Considered options

1. **Ephemeral registry only (status quo)** — simplest implementation and mental model; every restart is a clean slate. Lowest moving parts, but forces re-registration storms and surprises anyone treating registrations as “infrastructure state.”
2. **Full cluster / shared registry** — external database or replicated log, multiple proxy instances, clear HA story. Matches large deployments, but explodes scope (network partitions, split-brain, who owns TTL eviction, API key surface) for a single-machine product.
3. **Single-writer durable registry (chosen)** — persist the directory alongside the process, reload on startup, still one active writer. Matches the stated **single process operation** model in CONTEXT.md; avoids distributed systems tax while fixing restart durability.

## Consequences

- **Migrations**: When the persisted representation or domain rules change, operators need a clear upgrade path (version markers, one-way transforms, or documented “delete and re-register” escape hatch). Tests should cover reload after simulated crash and after orderly shutdown.
- **Crash consistency**: Abrupt termination can leave the on-disk view one commit behind the last in-memory truth, or in rare cases require recovery rules (e.g. last accepted write wins, optional integrity checks on load). The domain promises durability across restarts, not a distributed transaction log.
- **Backups**: Durability shifts responsibility to ops: snapshot or copy the persisted store with the same care as other machine-local state; restoring an older snapshot may resurrect stale **Permaclaim** entries or routing keys that backends have since abandoned.
- **Explicit non-goals**: No multi-instance registry, no automatic failover between proxy peers, no split-brain policy—those remain future ADRs if the product ever targets **clustered operation**.
