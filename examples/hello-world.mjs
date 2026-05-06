import http from 'http'

const HOST = 'hello.javagrant.ac.nz'
const PORT = 8081
const PROXY_URL = 'http://localhost:9080'
const API_KEY = 'dev-secret-change-me'
const HEARTBEAT_INTERVAL = 10_000

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`)
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end(`Hello from ${HOST}!\n`)
})

server.listen(PORT, async () => {
  console.log(`Service listening on :${PORT}`)
  await deregister()
  await register()
  startHeartbeat()
})

async function api(method, path, body) {
  const res = await fetch(`${PROXY_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function deregister() {
  const data = await api('DELETE', '/deregister', { host: HOST })
  if (data.success) console.log(`Deregistered previous ${HOST}`)
}

async function register() {
  const data = await api('POST', '/register', { host: HOST, port: PORT })
  if (data.success) {
    console.log(`Registered ${HOST} → :${PORT}`)
    console.log(`Test: curl -H 'Host: ${HOST}' http://localhost:9080/`)
  } else {
    console.error('Registration failed:', data)
  }
}

function startHeartbeat() {
  setInterval(async () => {
    const data = await api('POST', '/heartbeat', { host: HOST })
    if (!data.success) console.error('Heartbeat failed')
  }, HEARTBEAT_INTERVAL)
}

process.on('SIGTERM', async () => {
  await api('DELETE', '/deregister', { host: HOST })
  process.exit(0)
})
process.on('SIGINT', async () => {
  await api('DELETE', '/deregister', { host: HOST })
  process.exit(0)
})
