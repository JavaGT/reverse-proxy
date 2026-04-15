# DDNS management UI — ideal-UX-first restructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-page form-plus-summary DDNS experience with a task-oriented interface derived from an ideal user journey (status → setup → operate → tune), then align the API, persistence, and scheduler observability so the UI is honest and non-redundant.

**Architecture:** Keep **SQLite `meta.ddns`** and **`mergePutDdnsBody` / `buildDdnsPublicSummary`** as the source of truth for configuration; add a **small, separate persistence slice** (or reserved keys under `meta`) for **last-run telemetry** so the dashboard can show last sync time and outcome without reading log files. Split the monolithic **`rp-ddns-panel`** into focused custom elements (status strip, setup wizard or empty state, settings form, optional advanced panel) that still use **`apiFetch("/api/v1/ddns")`** for config and new read-only endpoints only where telemetry cannot live in the existing GET payload.

**Tech Stack:** Node.js ESM, Express management API, SQLite via `SqlitePersistence`, native custom elements (`rp-*`), existing `mgmt.css` patterns.

---

## Deprecation note (Cursor)

The **`/write-plan`** command is **deprecated**; prefer asking the agent to follow the **superpowers:writing-plans** skill (this document follows that structure).

---

## 1. Current structure (audit)

| Layer | Responsibility | Key files |
|-------|------------------|-----------|
| Page shell | Theme, header, help modal (network/DNS help duplicated from index) | `src/infrastructure/http/ui/ddns.html` |
| Panel | Single component: collapsible summary table, full form, bootstrap vs autosave, debounced PUTs | `src/infrastructure/http/ui/components/rp-ddns-panel.mjs` |
| Registration | `customElements.define("rp-ddns-panel", …)` | `src/infrastructure/http/ui/mgmt-custom-elements.mjs` |
| API | `GET/PUT/DELETE /api/v1/ddns` | `src/api/ManagementController.mjs` (`getDdns`, `putDdns`, `deleteDdns`), `src/infrastructure/http/ManagementServer.mjs` |
| Config merge / public summary | Validates PUT, builds scheduler-facing tick + UI summary | `src/ddns/ddnsConfigResolve.mjs` |
| Runtime | Periodic sync; logs only; IP cache in SQLite | `src/ddns/infrastructure/DdnsScheduler.mjs`, `DdnsSyncUseCase` |

**Pain points (UX):**

1. **Duplicate mental model** — Summary table repeats interval, zones, and match note that the form also edits.
2. **Heavy bootstrap** — First save requires both keys; autosave unlocks afterward; two different hint texts (`#ddns-enable-hint`, `#ddns-edit-note`).
3. **Weak operational feedback** — Scheduler state is a short code string; no **last successful sync**, **per-zone last error**, or **“sync now”** affordance.
4. **Buried safety story** — The match-note / Porkbun **notes** field contract is easy to miss despite the paragraph under the input.
5. **Split context** — User must jump to **Network** on the main page for live public IP/DNS; DDNS page only shows cached public IP in the summary.

---

## 2. Ideal experience (work backwards from the interface)

Assume a user who only cares about: *“Is my home server’s DNS pointing at my current public IP, and did Porkbun get updated?”*

### 2.1 Information architecture (target)

1. **Status strip (always on top)**  
   - **State badge:** `Not configured` | `Paused` | `Active`.  
   - **Public IP:** IPv4 / IPv6 (from existing `cachedPublicIp` or live refresh).  
   - **Last sync:** timestamp + outcome (`OK` / `Skipped (IP unchanged)` / `Failed`) + short error if failed.  
   - **Next check:** approximate ETA from interval + last run (or “scheduler idle” when disabled).  
   - **Primary actions:** `Run sync now` (when configured), link to **Network** for cross-check.

2. **Body by mode**  
   - **Not configured:** Empty state with **Connect Porkbun** CTA → guided steps (keys → zone source → match note → timing) → single **Save & enable** (or **Save** then **Enable** toggle).  
   - **Configured:** **Zones & safety** card (apex vs explicit list, match note with expandable “why this matters”), **Schedule** card (interval, IP lookup timeout), **Credentials** card (masked, rotate keys), **Advanced** collapsed (API base, discovery URLs), **Danger zone** (clear SQLite).

3. **Optional: per-zone table (dashboard row)**  
   - Columns: zone, “would update” / last result (requires backend to remember per-zone outcomes or derive from last run logs — see §3).

### 2.2 Interaction principles

- **One save model:** Prefer explicit **Save** for credential changes; optional autosave only for low-risk fields (interval, timeouts) to reduce accidental key churn, *or* keep autosave but make credential rows explicitly **Save** buttons (design choice in implementation).
- **No duplicate readonly table** — Either remove the big summary table or reduce it to **non-editable telemetry only** (last sync, cache, scheduler), not a mirror of form fields.
- **Help:** DDNS-specific help should live in `ddns.html` help modal only; trim duplication with `index.html` where possible.

---

## 3. Backend and data gaps (to support §2)

| UI need | Present today? | Approach |
|---------|----------------|----------|
| Last sync time / outcome | No structured data | After each `DdnsSyncUseCase.execute` completion (success, skip, error), persist e.g. `meta.ddns_status` JSON: `{ lastRunAt, lastOutcome, lastError?, perDomain?: [...] }` via a small helper in `SqlitePersistence` |
| “Run sync now” | No HTTP trigger | Add `POST /api/v1/ddns/sync` (local + auth, same as PUT) that runs one sync with current SQLite config (reuse scheduler’s wiring factory or extract shared `runDdnsOnce(ctx)` from `DdnsScheduler.mjs`) |
| Next run ETA | Partial (`schedulerWouldRun`, `schedulerState`) | Compute client-side from `lastRunAt + intervalMs` when `enabled` |
| Live public IP on DDNS page | Partial (`cachedPublicIp`) | Optional: `GET /api/v1/ddns` includes `refreshPublicIp: true` query that re-runs IP lookup once (careful: rate limits); *or* keep “open Network” link only (YAGNI default) |

**OpenAPI / errors:** Extend `src/api/openapi.yaml`, `src/api/llms.txt`, and `managementErrorResolutions.mjs` for new codes (e.g. `DDNS_SYNC_FAILED`, `DDNS_NOT_CONFIGURED`).

**Tests:** Extend `tests/unit/ddnsConfigResolve.test.mjs` for any new summary fields; add integration test for `POST /sync` in `tests/integration/ManagementServer.test.mjs`.

---

## 4. File map (planned)

| Create / split | Purpose |
|----------------|---------|
| `src/infrastructure/http/ui/components/rp-ddns-status.mjs` | Status strip + actions |
| `src/infrastructure/http/ui/components/rp-ddns-setup.mjs` | Empty / first-run flow |
| `src/infrastructure/http/ui/components/rp-ddns-settings.mjs` | Configured-mode forms (or keep one module with clear sections) |
| `src/ddns/ddnsRunOnce.mjs` (name as you prefer) | Extract one-shot sync callable from scheduler + new POST handler |
| `src/infrastructure/persistence/...` | `getDdnsLastRun` / `saveDdnsLastRun` (exact naming aligned with `SqlitePersistence` patterns) |

| Modify | Purpose |
|--------|---------|
| `rp-ddns-panel.mjs` | Orchestrator only: compose subcomponents, fewer innerHTML lines |
| `ManagementController.mjs` | `postDdnsSync`, extend `getDdns` with last-run payload |
| `SqlitePersistence.mjs` | Schema/meta accessors for `ddns_status` |
| `DdnsScheduler.mjs` | Call telemetry save after each cycle; delegate sync to shared runner |
| `openapi.yaml` | Document new fields and `POST /api/v1/ddns/sync` |

---

## 5. Implementation tasks

### Task A: Persistence — last-run blob

**Files:**

- Modify: `src/infrastructure/persistence/SqlitePersistence.mjs`
- Modify: `src/ddns/infrastructure/DdnsScheduler.mjs`
- Modify: `src/ddns/application/DdnsSyncUseCase.mjs` (or scheduler caller) to record outcomes
- Test: new unit test file under `tests/unit/` for serialization shape

- [ ] **Step A1: Define a minimal JSON shape** for `meta.ddns_last_run` (or nested under existing `meta` key strategy used elsewhere). Example shape:

```json
{
  "at": "2026-04-15T12:00:00.000Z",
  "outcome": "success",
  "detail": "3 record(s) updated",
  "skippedBecause": null
}
```

- [ ] **Step A2: Implement read/write** on `SqlitePersistence` following existing `getDdnsSettings` / `saveDdnsSettings` style (same transaction patterns).

- [ ] **Step A3: Write failing unit test** asserting round-trip of the blob.

- [ ] **Step A4: Run test** — `node --test tests/unit/<new-file>.mjs` — expect PASS after implementation.

- [ ] **Step A5: Wire scheduler** — after `DdnsSyncUseCase.execute` returns or throws, persist outcome (success path, skip path, error path with message truncated for UI).

- [ ] **Step A6: Commit** — `git add` persistence + scheduler + tests; `git commit -m "feat(ddns): persist last sync outcome for management UI"`.

---

### Task B: API — expose telemetry on GET

**Files:**

- Modify: `src/api/ManagementController.mjs` (`getDdns`)
- Modify: `src/ddns/ddnsConfigResolve.mjs` only if summary composition should include last-run (prefer thin controller merge)
- Modify: `src/api/openapi.yaml`
- Test: `tests/integration/ManagementServer.test.mjs` or unit test for `buildDdnsPublicSummary` if extended

- [ ] **Step B1: Extend GET response `data`** with `lastRun: null | { at, outcome, detail, skippedBecause }` without breaking existing clients (additive fields only).

- [ ] **Step B2: OpenAPI** — document new properties under the DDNS schema.

- [ ] **Step B3: Run** `npm test` — fix regressions.

- [ ] **Step B4: Commit**.

---

### Task C: API — POST sync once

**Files:**

- Create: shared runner module extracted from `DdnsScheduler.mjs` (single place that constructs `PorkbunDnsProvider`, `HttpIpLookup`, `DdnsSyncUseCase`)
- Modify: `src/infrastructure/http/ManagementServer.mjs` — `router.post("/ddns/sync", ...)`
- Modify: `ManagementController.mjs` — `postDdnsSync`
- Test: integration test with mocked persistence or harness pattern used in `ManagementServer.test.mjs`

- [ ] **Step C1: Extract `runDdnsSyncOnce({ persistence, getApexDomains, logger })`** from scheduler internals so scheduler and HTTP handler share logic.

- [ ] **Step C2: Implement `postDdnsSync`** — return `{ data: { ...summary, lastRun } }` mirroring GET after sync; on failure return API error with stable `code`.

- [ ] **Step C3: Integration test** — `POST /api/v1/ddns/sync` returns 400/501 when not configured; 200 path with stubbed deps if the suite supports it.

- [ ] **Step C4: Commit**.

---

### Task D: UI — compose ideal layout

**Files:**

- Modify: `src/infrastructure/http/ui/components/rp-ddns-panel.mjs`
- Create: `rp-ddns-status.mjs` (or inline first section in panel if split deferred)
- Modify: `src/infrastructure/http/ui/mgmt-custom-elements.mjs` if new tags
- Modify: `src/infrastructure/http/ui/mgmt.css` — scoped classes for status strip / empty state

- [ ] **Step D1: Build static HTML structure** in `render()` for: status strip → conditional empty vs settings; **remove** duplicate summary rows that mirror editable fields (keep telemetry-only rows moved to status).

- [ ] **Step D2: Add “Run sync now”** button calling `apiFetch("/api/v1/ddns/sync", { method: "POST" })` when `credentialsConfigured && configSource === "sqlite"`; show toast or `#ddns-form-status` message from response.

- [ ] **Step D3: Re-test bootstrap flow** — first-time user: keys → submit → autosave enabled; ensure no regression in `#buildPutBody()` field names.

- [ ] **Step D4: Manual browser pass** on `ddns.html` (light/dark, keyboard).

- [ ] **Step D5: Commit**.

---

### Task E: Client package alignment (if applicable)

**Files:**

- Modify: `packages/reverse-proxy-client/src/httpClient.mjs` (or `autoClient`) if DDNS helpers exist
- Modify: `packages/reverse-proxy-client/README.md` only if public API promises DDNS methods

- [ ] **Step E1: Add `postDdnsSync` to HTTP client** if other methods are wrapped.

- [ ] **Step E2: Run** `npm test` in workspace including client tests.

- [ ] **Step E3: Commit**.

---

## 6. Self-review (writing-plans checklist)

| Spec slice | Task covering it |
|------------|------------------|
| Status strip / last sync | A, B, D |
| Run sync now | C, D |
| Reduced duplication / clearer setup | D (panel restructure) |
| OpenAPI / integrations docs | B, C |
| Shared scheduler logic | C |

**Placeholder scan:** No `TBD` items; optional “live IP refresh on DDNS page” is explicitly deferred to §3 YAGNI default.

**Consistency:** `lastRun` field name used consistently in persistence, GET, and POST responses.

---

## 7. Execution handoff

Plan saved to `docs/superpowers/plans/2026-04-15-ddns-ux-restructure.md`.

**1. Subagent-driven (recommended)** — Fresh subagent per task (A → E), review between tasks.

**2. Inline execution** — Run tasks in order in one session with checkpoints after each commit.

Which approach do you want?
