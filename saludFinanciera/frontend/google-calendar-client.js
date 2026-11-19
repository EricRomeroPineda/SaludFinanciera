export const googleCalendarScope = 'https://www.googleapis.com/auth/calendar.events.owned'
const eventsUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const labels = {
  card: 'Pago de tarjeta', subscription: 'Suscripción / servicio',
  plan: 'Aportación a plan', loan: 'Deuda · Fecha compromiso',
}
let identityPromise

export function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve()
  if (identityPromise) return identityPromise
  identityPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    const timeout = setTimeout(() => failed(), 20000)
    const failed = () => {
      clearTimeout(timeout)
      script.remove()
      identityPromise = null
      reject(new Error('No se pudo cargar la conexión con Google. Revisa internet y los bloqueadores del navegador.'))
    }
    script.onerror = failed
    script.onload = () => {
      if (!globalThis.google?.accounts?.oauth2) { failed(); return }
      clearTimeout(timeout)
      resolve()
    }
    document.head.append(script)
  })
  return identityPromise
}

export function requestGoogleAccess(clientId) {
  return new Promise((resolve, reject) => {
    const oauth = globalThis.google?.accounts?.oauth2
    if (!oauth) { reject(new Error('La conexión con Google aún no está lista. Vuelve a abrir la vista previa.')); return }
    const client = oauth.initTokenClient({
      client_id: clientId, scope: googleCalendarScope, include_granted_scopes: false,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error('Google no autorizó el acceso. No se enviaron los recordatorios.'))
        } else if (!oauth.hasGrantedAllScopes(response, googleCalendarScope)) {
          reject(new Error('Debes permitir el acceso a los eventos de Google Calendar para sincronizar.'))
        } else {
          resolve(response.access_token)
        }
      },
      error_callback: (error) => reject(new Error(error.type === 'popup_closed'
        ? 'Cerraste la autorización de Google. No se enviaron los recordatorios.'
        : 'No se pudo abrir la autorización de Google. Permite ventanas emergentes e inténtalo otra vez.')),
    })
    client.requestAccessToken({ prompt: 'select_account' })
  })
}

export function prepareGoogleReminders(month, events) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('El mes seleccionado no es válido.')
  const occurrences = new Map()
  return [...events].sort((a, b) => a.date.localeCompare(b.date)).map((event) => {
    const sourceId = { card: event.destinationAccountId, subscription: event.subscriptionId,
      plan: event.planId, loan: event.loanId }[event.kind]
    if (!labels[event.kind] || !Number.isSafeInteger(Number(sourceId)) || Number(sourceId) <= 0 ||
        !event.date.startsWith(`${month}-`) || !validDate(event.date)) {
      throw new Error('Hay un marcador previsto sin fecha o identificador válido. Actualiza el calendario.')
    }
    const source = `${event.kind}:${sourceId}`
    const occurrence = (occurrences.get(source) || 0) + 1
    occurrences.set(source, occurrence)
    // Loans have one commitment; recurring payments retain a separate identity per month.
    const key = event.kind === 'loan' ? source : `${source}:${month}:${occurrence}`
    return { ...event, key, typeLabel: labels[event.kind] }
  })
}

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T12:00:00Z`)) &&
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date
}

export async function googleEventId(namespace, key) {
  if (!/^[a-f0-9]{64}$/.test(namespace)) throw new Error('La identidad de sincronización no es válida. Abre otra vez la vista previa.')
  if (!globalThis.crypto?.subtle) throw new Error('Abre la aplicación desde localhost o HTTPS para sincronizar con Google.')
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${namespace}:${key}`))
  return `sf${[...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function googleEventBody(event, namespace, phase = 'due') {
  if (!validDate(event.date) || !['due', 'previous'].includes(phase) || event.reference) {
    throw new Error('El recordatorio necesita una fecha exacta y una fase válida.')
  }
  const date = new Date(`${event.date}T12:00:00Z`)
  if (phase === 'previous') date.setUTCDate(date.getUTCDate() - 1)
  const start = new Date(`${date.toISOString().slice(0, 10)}T21:00:00`)
  const amount = event.amount == null ? 'Monto por definir' :
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(event.amount))
  const deposit = event.kind === 'loan' && event.loanType === 'me_deben' ? null : event.depositDetails
  const description = [
    'Recordatorio de Salud Financiera.', `Concepto: ${event.label}`, `Tipo: ${event.typeLabel}`,
    `Fecha límite: ${event.date}`, `Monto previsto: ${amount}`,
    ...(deposit ? [`Datos de depósito: ${deposit}`] : []),
    `Avisos: 09:00, 14:00 y 21:00 ${phase === 'previous' ? 'del día anterior' : 'del día límite'}.`,
    'No registra un pago ni modifica tus saldos.',
  ].map((line) => line.replace(/[&<>"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  })[character])).join('\n')
  return {
    summary: `${phase === 'previous' ? 'Mañana · ' : ''}${event.typeLabel} · ${event.label}`,
    description,
    start: { dateTime: start.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: new Date(start.getTime() + 15 * 60000).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    visibility: 'private', transparency: 'transparent',
    reminders: { useDefault: false, overrides: [
      { method: 'popup', minutes: 720 }, { method: 'popup', minutes: 420 }, { method: 'popup', minutes: 0 },
    ] },
    extendedProperties: { private: { saludFinanciera: namespace,
      sourceKey: phase === 'previous' ? `${event.key}:previous` : event.key } },
  }
}

async function googleRequest(token, url, { method = 'GET', body, signal } = {}) {
  let response
  try {
    response = await fetch(url, {
      method, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]),
      credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    if (error.name === 'TimeoutError') {
      throw new Error('Google tardó demasiado en responder. Reintenta; se comprobará el mismo evento antes de volver a crearlo.')
    }
    throw new Error('No se pudo contactar con Google. Revisa internet; puedes reintentar sin duplicar los eventos.')
  }
  if (!response.ok) {
    const messages = {
      401: 'El permiso de Google venció o fue revocado. Vuelve a autorizar para continuar.',
      403: 'Google rechazó el acceso. Revisa que Calendar API esté habilitada, los permisos y los usuarios de prueba.',
      404: 'No se encontró el evento o el calendario de Google.',
      409: 'El evento ya existe en Google.',
      410: 'El evento fue eliminado en Google. Restáuralo desde la papelera antes de volver a sincronizarlo.',
      429: 'Google limitó las solicitudes. Espera unos minutos antes de reintentar.',
    }
    throw Object.assign(new Error(messages[response.status] || `Google no pudo guardar el recordatorio (HTTP ${response.status}).`),
      { status: response.status })
  }
  return response.json()
}

async function syncGoogleEvent(token, namespace, event, phase, signal) {
  const key = phase === 'previous' ? `${event.key}:previous` : event.key
  const id = await googleEventId(namespace, key)
  const url = `${eventsUrl}/${id}`
  const body = await googleEventBody(event, namespace, phase)
  let existing
  try {
    existing = await googleRequest(token, url, { signal })
  } catch (error) {
    if (error.status !== 404) throw error
  }
  if (!existing) {
    try {
      await googleRequest(token, eventsUrl, { method: 'POST', body: { id, ...body }, signal })
      return 'created'
    } catch (error) {
      // A retry after a lost response, or a concurrent sync, must never create a second event.
      if (error.status !== 409) throw error
      existing = await googleRequest(token, url, { signal })
    }
  }
  if (existing.status === 'cancelled') {
    throw new Error('El evento fue eliminado en Google. Restáuralo desde la papelera para volver a sincronizarlo.')
  }
  const metadata = existing.extendedProperties?.private
  if (metadata?.saludFinanciera !== namespace || metadata.sourceKey !== key) {
    throw new Error('El evento existente no pertenece a esta sincronización. No se modificó.')
  }
  await googleRequest(token, url, { method: 'PATCH', body, signal })
  return 'updated'
}

export async function syncGoogleReminder(token, namespace, event, signal) {
  const due = await syncGoogleEvent(token, namespace, event, 'due', signal)
  try {
    const previous = await syncGoogleEvent(token, namespace, event, 'previous', signal)
    return due === 'created' && previous === 'created' ? 'created' : 'updated'
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw Object.assign(new Error(`El evento del día límite ya está guardado; faltó el del día anterior: ${error.message}`),
      { status: error.status })
  }
}
