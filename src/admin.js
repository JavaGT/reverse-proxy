import http from 'http'
import { createReply } from './http/reply.js'
import { readJsonBody } from './http/body.js'

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>reverse-proxy admin</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem; color: #f8fafc; }
h1 span { color: #64748b; font-weight: 400; }
table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
th, td { text-align: left; padding: 0.75rem 1rem; border-bottom: 1px solid #1e293b; }
th { color: #94a3b8; font-weight: 500; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
td { font-size: 0.875rem; }
.tag { display: inline-block; padding: 0.125rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 500; }
.tag-heartbeat { background: #1e3a5f; color: #60a5fa; }
.tag-permaclaim { background: #3b1f1f; color: #f87171; }
.tag-alive { background: #14532d; color: #4ade80; }
.tag-stale { background: #3b1f1f; color: #f87171; }
.btn { padding: 0.375rem 0.75rem; border: none; border-radius: 6px; font-size: 0.75rem; cursor: pointer; }
.btn-danger { background: #7f1d1d; color: #fca5a5; }
.btn-danger:hover { background: #991b1b; }
.btn-primary { background: #1e3a5f; color: #93c5fd; padding: 0.5rem 1rem; font-size: 0.875rem; }
.btn-primary:hover { background: #1e40af; }
form { display: flex; gap: 0.75rem; align-items: end; flex-wrap: wrap; }
form label { font-size: 0.75rem; color: #94a3b8; display: block; margin-bottom: 0.25rem; }
form input, form select { padding: 0.5rem; border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; font-size: 0.875rem; }
form input:focus, form select:focus { outline: none; border-color: #3b82f6; }
.field { display: flex; flex-direction: column; }
.empty { color: #64748b; text-align: center; padding: 3rem; }
.loading { color: #64748b; }
.error { color: #ef4444; margin-bottom: 1rem; }
.success { color: #22c55e; margin-bottom: 1rem; }
#msg { margin-bottom: 1rem; font-size: 0.875rem; }
.refresh { color: #64748b; font-size: 0.75rem; margin-left: 0.5rem; cursor: pointer; text-decoration: underline; }
</style>
</head>
<body>
<h1>reverse-proxy <span>admin</span></h1>
<div id="msg"></div>
<table><thead><tr><th>Host</th><th>Port</th><th>Type</th><th>Status</th><th>Last Heartbeat</th><th></th></tr></thead><tbody id="services"></tbody></table>
<h2>Register service</h2>
<form id="register-form">
<div class="field"><label>Host</label><input name="host" placeholder="foo.example.com" required></div>
<div class="field"><label>Port</label><input name="port" type="number" required></div>
<div class="field"><label>Type</label><select name="heartbeat"><option value="true">Heartbeat</option><option value="false">Permaclaim</option></select></div>
<button class="btn btn-primary" type="submit">Register</button>
</form>
<script>
const msg = (text, type) => { const el = document.getElementById('msg'); el.textContent = text; el.className = type || ''; setTimeout(() => el.className = '', 3000) }

async function load() {
  try {
    const res = await fetch('/api/services')
    if (!res.ok) { document.getElementById('services').innerHTML = '<tr><td colspan="6" class="error">Failed to load: ' + res.status + '</td></tr>'; return }
    const data = await res.json()
    const tbody = document.getElementById('services')
    const entries = data.services ? Object.entries(data.services) : []
    if (entries.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No services registered</td></tr>'; return }
    tbody.innerHTML = entries.map(([host, svc]) => {
      const isHeartbeat = svc.heartbeat
      const isAlive = isHeartbeat && svc.lastHeartbeat && (Date.now() - svc.lastHeartbeat < 60000)
      return '<tr><td>' + host + '</td><td>' + svc.port + '</td><td><span class="tag tag-' + (isHeartbeat ? 'heartbeat' : 'permaclaim') + '">' + (isHeartbeat ? 'heartbeat' : 'permaclaim') + '</span></td><td><span class="tag tag-' + (isAlive ? 'alive' : 'stale') + '">' + (isAlive ? 'alive' : 'stale') + '</span></td><td>' + (svc.lastHeartbeat ? new Date(svc.lastHeartbeat).toLocaleString() : '\u2014') + '</td><td><button class="btn btn-danger" data-host="' + host.replace(/"/g, '&quot;') + '">Remove</button></td></tr>'
    }).join('')
  } catch (err) {
    document.getElementById('services').innerHTML = '<tr><td colspan="6" class="error">Error: ' + err.message + '</td></tr>'
  }
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-danger')
  if (!btn) return
  const host = btn.getAttribute('data-host')
  await fetch('/api/deregister', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host }) })
  msg('Deregistered ' + host, 'success')
  load()
})

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const fd = new FormData(e.target)
  const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: fd.get('host'), port: Number(fd.get('port')), heartbeat: fd.get('heartbeat') === 'true' }) })
  const data = await res.json()
  if (data.success) { msg('Registered ' + fd.get('host'), 'success'); e.target.reset(); load() }
  else { msg('Failed: ' + (data.error || 'unknown'), 'error') }
})

load()
setInterval(load, 5000)
</script>
</body>
</html>`

export async function startAdminServer(registry, port) {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname

    try {
      if (req.method === 'GET' && pathname === '/') {
        createReply(res).type('text/html').send(PAGE)
        return
      }

      if (req.method === 'GET' && pathname === '/api/services') {
        createReply(res).code(200).send({ services: registry.getServices() })
        return
      }

      if (req.method === 'POST' && pathname === '/api/register') {
        const body = await readJsonBody(req)
        const reply = createReply(res)
        const { host, port: svcPort, heartbeat } = body
        if (!host || !svcPort) {
          reply.code(400).send({ error: 'host and port required' })
          return
        }
        const result = registry.register(host, { port: svcPort, heartbeat: heartbeat !== false })
        if (!result.success) reply.code(409).send(result)
        else reply.send({ success: true })
        return
      }

      if (req.method === 'POST' && pathname === '/api/deregister') {
        const body = await readJsonBody(req)
        const reply = createReply(res)
        const { host } = body
        if (!host) {
          reply.code(400).send({ error: 'host required' })
          return
        }
        const removed = registry.deregister(host)
        if (!removed) reply.code(404).send({ error: 'not found' })
        else reply.send({ success: true })
        return
      }

      createReply(res).code(404).send({ error: 'Not found' })
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  console.log(`Admin UI at http://127.0.0.1:${port}`)
  return {
    server,
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}
