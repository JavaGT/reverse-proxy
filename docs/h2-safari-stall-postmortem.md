# H2 Safari 13s Stall — Postmortem

**Date**: 2026-05-16  
**Scope**: Reverse proxy + Scope app  
**Symptom**: 13s gap between HTML receipt and first sub-resource fetch in Safari. Chrome unaffected.

---

## Symptoms

- First page load after idle → **13s of blank/loading** with 100% CPU
- Then all resources (CSS, JS, API) flood out simultaneously in ~300ms
- Subsequent navigations fast
- After idle period (minutes) → slow again
- Chrome always fast
- `performance.mark()` showed HTML arrived at ~20ms but **parser didn't start until ~13000ms**

```
after-css-link:     12999ms   ← first parsed tag (13s after navigation start)
body-end:           13003ms   ← entire page parsed in 4ms
after-css-link→body-end: 4ms  ← parsing itself is instant
```

The 13s was **before any HTML tag was processed** — not a CSS, importmap, or module script issue.

---

## Root Cause

**Safari H2 session staleness.** The sequence:

1. Safari opens an H2 connection to the proxy
2. After idle time, the proxy-side TCP connection is silently dropped (OS/firewall idle timeout)
3. Safari doesn't detect the closure — its H2 session thinks the connection is still alive
4. User navigates: Safari sends request on stale session → request succeeds at H2 level (new upstream connection is created) → response bytes arrive → Safari's H2 layer holds them in the receive buffer
5. Safari waits ~13s for its internal H2 recovery timeout to expire before releasing bytes to the HTML parser
6. Parser finally runs, page renders in ~300ms
7. Next navigation uses a re-established connection → fast

---

## Fixes Applied

### Reverse proxy (`reverse-proxy.javagrant.ac.nz/src/server.js`)

| Fix | Code | Why |
|---|---|---|
| **TCP keepalive** | `socket.setKeepAlive(true, 10000)` on every connection | Safari detects proxy-side socket drops in ~10s instead of up to 2 hours (OS default) |
| **Session rotation** | GOAWAY after 2000 requests per session | Prevents long-lived H2 sessions from accumulating packet loss and prioritization drift. Browser creates a fresh connection. |
| **Session timeout** | `session.setTimeout(600_000)` → graceful GOAWAY at 10min idle | Default was infinite — stale sessions lived forever. GOAWAY allows in-flight requests to finish. |
| **Stream limits** | `settings.maxConcurrentStreams: 100` | Prevents stream starvation when many resources are loaded in parallel |
| **HPACK table bound** | `maxDeflateDynamicTableSize: 4096` | Prevents HPACK memory growth over long sessions |
| **Event loop monitor** | `performance.monitorEventLoopDelay()` p95/p99 check every 30s | Logs if lag >100ms so H2 latency spikes can be correlated with proxy CPU |

### Reverse proxy (`reverse-proxy.javagrant.ac.nz/src/routes/proxy.js`)

| Fix | Code | Why |
|---|---|---|
| **Strip ETag** | `'etag'` added to `STRIP_HEADERS` | Prevents 304 responses. 304 + H2 + Safari = known END_STREAM stall bug where Safari hangs in "receive" for ~10s |
| **Reduce buffer** | `MAX_BUFFER` 1MB → 4KB | Headers flush after 4KB instead of waiting for full render. Browser gets early byte start. |
| **Backpressure** | `if (!ok) upstreamRes.pause()` + `drain` handler | Streaming path properly pauses upstream when browser buffers are full |

### Scope app (`scope`)

| Fix | File | Why |
|---|---|---|
| **Batch SQL queries** | `lib/data/projects.js` | Homepage ran 1+6N sequential sync queries (N=projects). For 10 projects: 61 queries blocking ~3-12s. Reduced to 2 queries total. |
| **Pug view cache** | `lib/http-app.js` | `app.enable('view cache')` — templates recompiled via `new Function()` on every request without this. 5-20ms per render saved. |
| **Import map last** | `views/project-layout.pug` | Moved `<script type="importmap">` to end of `<head>`. Safari's preload scanner stalls at import map boundaries; CSS/module scripts before it are discovered and fetched early. |
| **Cache-Control** | `lib/http-app.js` | `no-cache` → `private, max-age=30`. 30s browser cache eliminates redundant revalidation requests. |
| **ETag suppressed** | `lib/http-app.js` | `res.setHeader('ETag', '')` — prevents Express from computing its own ETag (redundant with proxy-level ETag stripping) |

---

## How the 13s Gap Was Diagnosed

1. **HAR waterfall comparison** — Production (`scope.javagrant.ac.nz`) showed 9970ms for a 304 with zero bytes; localhost showed 357ms for a 200 with full body. Implicated the proxy/H2 path.

2. **Performance markers** — Injected `performance.mark()` at 5 HTML positions. Showed the entire 13s was before `<link rel="stylesheet">` was even parsed — eliminating parser-blocking theories (CSS, importmap, modules).

3. **Safari Timeline recording** — Showed **one single rendering frame** covering the entire 13s gap, with CPU at 100% on the main thread, zero script/layout/network events. Confirmed the stall was in Safari's navigation pipeline, not in page processing.

4. **Style-only HAR** — Loading just `style.css` directly showed the same 13s receive time (TTFB=0ms, receive=13215ms). Proved the issue was site-wide, not page-specific.

5. **Navigation test** — Loading the page, navigating away to google.com, and back was fast. After idle, returned to slow. Confirmed H2 session reuse pattern.

---

## Prevention

- **TCP keepalive** on all H2 server connections (default Node.js behavior is no keepalive)
- **Session rotation** via periodic GOAWAY prevents any single session from degrading over time
- **Event loop monitor** catches proxy-side blocking before users notice
- **ETag stripping** at the proxy level prevents Safari H2 304 END_STREAM stall regardless of upstream server behavior
