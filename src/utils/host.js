export function extractSubdomain(request) {
  const host = request.headers.host || ''
  const parts = host.split('.')
  if (parts.length >= 2) {
    return parts[0]
  }
  return null
}

export function extractBaseHost(request) {
  const host = request.headers.host || ''
  const parts = host.split('.')
  if (parts.length >= 2) {
    return parts.slice(1).join('.')
  }
  return host
}
