/** Host for routing: HTTP/1 `Host` or HTTP/2 `:authority` (Node exposes both on `headers`). */
export function getRequestHost(req) {
  const raw = req.headers?.host || req.headers?.[':authority']
  if (raw == null || raw === '') return ''
  return String(raw)
}

export function extractSubdomain(request) {
  const host = getRequestHost(request) || ''
  const parts = host.split('.')
  if (parts.length >= 2) {
    return parts[0]
  }
  return null
}

export function extractBaseHost(request) {
  const host = getRequestHost(request) || ''
  const parts = host.split('.')
  if (parts.length >= 2) {
    return parts.slice(1).join('.')
  }
  return host
}
