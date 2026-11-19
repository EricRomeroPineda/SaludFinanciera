import { createHmac } from 'node:crypto'

export async function handleGoogleCalendarRoute(request, response, url, { getUserId, sendJson }) {
  if (request.method !== 'GET' || url.pathname !== '/api/calendar/google-config') return false
  const userId = await getUserId(request, response)
  if (!userId) return true
  if (url.searchParams.get('view') === 'family') {
    throw Object.assign(new Error('Sincroniza tus recordatorios desde la vista Individual.'), { statusCode: 403 })
  }
  const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID || '').trim()
  if (!clientId) {
    sendJson(response, 200, { configured: false })
    return true
  }
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('GOOGLE_CALENDAR_CLIENT_ID no es un ID de cliente OAuth válido.')
  }
  if (Buffer.byteLength(process.env.SESSION_SECRET || '') < 32) {
    throw new Error('SESSION_SECRET debe estar configurado para identificar la sincronización.')
  }
  const namespace = createHmac('sha256', process.env.SESSION_SECRET)
    .update(`google-calendar:${userId}`).digest('hex')
  sendJson(response, 200, { configured: true, clientId, namespace })
  return true
}
