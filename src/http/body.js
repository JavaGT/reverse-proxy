/**
 * Read and parse JSON body (control plane only). Returns {} for empty body.
 */
export async function readJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {}

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { __parseError: true }
  }
}
