export function json(data, init = {}) {
  return Response.json(data, {
    status: init.status || 200,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      ...(init.headers || {}),
    },
  })
}

export function errorResponse(message, status = 400, code) {
  return json({ error: message, ...(code ? { code } : {}) }, { status })
}

export async function readJson(request) {
  try {
    const value = await request.json()
    return value && typeof value === 'object' ? value : {}
  } catch {
    throw errorResponse('Invalid JSON body.', 400, 'INVALID_JSON')
  }
}

export function notFound() {
  return errorResponse('Not found.', 404, 'NOT_FOUND')
}

export function methodNotAllowed(methods) {
  return errorResponse('Method not allowed.', 405, 'METHOD_NOT_ALLOWED', {
    Allow: methods.join(', '),
  })
}
