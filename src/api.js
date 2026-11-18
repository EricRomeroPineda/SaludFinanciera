export async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = response.status === 404 && payload.error === 'Ruta no encontrada.'
      ? 'El backend no reconoce esta ruta. Reinicia el servidor con npm run server para cargar la versión actual.'
      : payload.error || 'No se pudo completar la solicitud.'
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return payload
}
