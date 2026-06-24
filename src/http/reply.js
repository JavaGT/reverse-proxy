/**
 * Minimal reply shim compatible with existing route handlers (code/type/headers/send).
 */
export function createReply(res) {
  const state = {
    code: 200,
    headers: {},
    contentType: null,
    sent: false,
  }

  return {
    code(c) {
      state.code = c
      return this
    },
    type(t) {
      state.contentType = t
      return this
    },
    headers(h) {
      Object.assign(state.headers, h)
      return this
    },
    isSent() {
      return state.sent
    },
    send(body) {
      if (state.sent) return
      state.sent = true

      if (body === null || body === undefined) {
        res.writeHead(state.code, headerObject(state))
        res.end()
        return
      }

      if (typeof body === 'string' || Buffer.isBuffer(body)) {
        const payload = Buffer.isBuffer(body) ? body : Buffer.from(body)
        const hdrs = headerObject(state)
        hdrs['Content-Length'] = payload.length
        res.writeHead(state.code, hdrs)
        res.end(payload)
        return
      }

      const payload = Buffer.from(JSON.stringify(body))
      res.writeHead(state.code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length,
        ...headerObject(state)
      })
      res.end(payload)
    },
  }
}

function headerObject(state) {
  const h = { ...state.headers }
  if (state.contentType) h['Content-Type'] = state.contentType
  return h
}
