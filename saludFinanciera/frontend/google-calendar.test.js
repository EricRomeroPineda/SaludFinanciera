import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import {
  googleCalendarScope, googleEventBody, googleEventId, prepareGoogleReminders,
  requestGoogleAccess, syncGoogleReminder,
} from './google-calendar-client.js'

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css?inline')) return { format: 'module', source: 'export default ""', shortCircuit: true }
    return next(url, context)
  },
})
const components = new Map()
globalThis.customElements = { define: (name, component) => components.set(name, component) }
globalThis.google = null
await import('./calendario.js')
const sync = components.get('google-calendar-sync').prototype
const calendar = components.get('financial-calendar').prototype
const namespace = 'a'.repeat(64)
const month = '2026-11'
const marker = { kind: 'loan', loanId: 7, label: 'Ana · Yo debo', date: '2026-11-25', amount: 125 }
const [reminder] = prepareGoogleReminders(month, [marker])
const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status })

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  return value == null || typeof value === 'function' ? '' : String(value)
}

function googleMock(t, outcome = {}) {
  const oauth = {
    hasGrantedAllScopes: () => true,
    initTokenClient: (config) => ({
      requestAccessToken: (options) => {
        assert.deepEqual(options, { prompt: 'select_account' })
        assert.equal(config.scope, googleCalendarScope)
        assert.equal(config.include_granted_scopes, false)
        if (outcome.popup) config.error_callback({ type: outcome.popup })
        else config.callback({ access_token: 'test-only-token', ...outcome })
      },
    }),
  }
  const previous = globalThis.google
  globalThis.google = { accounts: { oauth2: oauth } }
  t.after(() => { globalThis.google = previous })
  return oauth
}

test('preview covers each supported marker with stable identities across date, amount and selection changes', async () => {
  const events = prepareGoogleReminders(month, [
    { kind: 'card', destinationAccountId: 3, label: 'Tarjeta', date: '2026-11-23' },
    { kind: 'subscription', subscriptionId: 4, label: 'Servicio', date: '2026-11-05', reference: true },
    { kind: 'plan', planId: 5, label: 'Ahorro', date: '2026-11-10' },
    { kind: 'plan', planId: 5, label: 'Ahorro', date: '2026-11-17' },
    marker,
  ])
  assert.deepEqual(events.map((event) => event.kind), ['subscription', 'plan', 'plan', 'card', 'loan'])
  assert.notEqual(events[1].key, events[2].key)
  const [moved] = prepareGoogleReminders('2026-12', [{ ...marker, date: '2026-12-01', amount: 100 }])
  assert.equal(await googleEventId(namespace, moved.key), await googleEventId(namespace, reminder.key))
  const changed = prepareGoogleReminders(month, [{ ...marker, date: '2026-11-27', amount: 50 }])[0]
  assert.equal(changed.key, reminder.key)
  assert.notEqual(await googleEventId('b'.repeat(64), changed.key), await googleEventId(namespace, changed.key))
  assert.match(await googleEventId(namespace, reminder.key), /^[0-9a-v]{5,1024}$/)
  assert.throws(() => prepareGoogleReminders(month, [{ ...marker, loanId: undefined }]), /identificador válido/)
  assert.throws(() => prepareGoogleReminders(month, [{ ...marker, date: '2026-11-31' }]), /identificador válido/)
  assert.throws(() => prepareGoogleReminders(month, [{ ...marker, date: '2026-12-01' }]), /identificador válido/)
})

test('Google payload is private, includes deposit details and schedules 09:00, 14:00 and 21:00 on both days', async () => {
  const body = await googleEventBody({ ...reminder, depositDetails: 'Cuenta 001234, Banco prueba' }, namespace)
  assert.match(body.summary, /Deuda.*Ana/)
  assert.match(body.description, /125\.00/)
  assert.equal(body.visibility, 'private')
  assert.equal(body.transparency, 'transparent')
  assert.deepEqual(body.reminders, { useDefault: false, overrides: [
    { method: 'popup', minutes: 720 }, { method: 'popup', minutes: 420 }, { method: 'popup', minutes: 0 },
  ] })
  assert.equal(new Date(body.start.dateTime).getHours(), 21)
  assert.match(body.description, /Datos de depósito: Cuenta 001234, Banco prueba/)
  assert.match(body.description, /Fecha límite: 2026-11-25/)
  assert.equal(Date.parse(body.end.dateTime) - Date.parse(body.start.dateTime), 15 * 60000)
  assert.equal(body.extendedProperties.private.saludFinanciera, namespace)
  assert.equal(body.attachments, undefined)
  assert.equal(body.attendees, undefined)
  const previous = await googleEventBody(reminder, namespace, 'previous')
  assert.match(previous.summary, /^Mañana/)
  assert.equal(previous.extendedProperties.private.sourceKey, `${reminder.key}:previous`)
  const notices = [previous, body].flatMap((event) => event.reminders.overrides.map((notice) => {
    const date = new Date(Date.parse(event.start.dateTime) - notice.minutes * 60000)
    return `${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
  }))
  assert.deepEqual(notices, ['24 9:00', '24 14:00', '24 21:00', '25 9:00', '25 14:00', '25 21:00'])
  for (const phase of ['previous', 'due']) {
    const omitted = await googleEventBody({ ...reminder, loanType: 'me_deben', depositDetails: 'Private account' }, namespace, phase)
    assert.doesNotMatch(omitted.description, /Private account|Datos de depósito/)
  }
  const escaped = await googleEventBody({ ...reminder, depositDetails: '<b>001234</b>' }, namespace)
  assert.match(escaped.description, /&lt;b&gt;001234&lt;\/b&gt;/)
  await assert.rejects(googleEventBody({ ...reminder, reference: true }, namespace), /fecha exacta/)
  await assert.rejects(googleEventBody(reminder, namespace, 'invalid'), /fase válida/)
})

test('first send creates two events; retry updates the same IDs including the original pre-upgrade due event', async (t) => {
  const calls = []
  const existing = new Map()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    assert.equal(options.headers.Authorization, 'Bearer test-token')
    assert.equal(options.credentials, 'omit')
    const id = url.split('/').pop()
    if (options.method === 'GET') return existing.has(id) ? response(existing.get(id)) : response({}, 404)
    const body = JSON.parse(options.body)
    existing.set(body.id || id, { ...existing.get(id), ...body })
    return response(existing.get(body.id || id))
  })
  assert.equal(await syncGoogleReminder('test-token', namespace, reminder), 'created')
  const originalIds = [...existing.keys()]
  assert.ok(originalIds.includes(await googleEventId(namespace, reminder.key)))
  assert.equal(existing.size, 2)
  assert.equal(await syncGoogleReminder('test-token', namespace, { ...reminder, amount: 50 }), 'updated')
  assert.deepEqual([...existing.keys()], originalIds)
  assert.deepEqual(calls.map(({ options }) => options.method), ['GET', 'POST', 'GET', 'POST', 'GET', 'PATCH', 'GET', 'PATCH'])
  for (const event of existing.values()) assert.match(event.description, /50\.00/)
})

test('a failed previous-day event leaves an explicit partial result; retry completes the pair without duplicating the due event', async (t) => {
  const saved = new Map()
  let failPrevious = true
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const id = url.split('/').pop()
    if (options.method === 'GET') return saved.has(id) ? response(saved.get(id)) : response({}, 404)
    const body = JSON.parse(options.body)
    if (body.extendedProperties.private.sourceKey.endsWith(':previous') && failPrevious) return response({}, 500)
    saved.set(body.id || id, { ...saved.get(id), ...body })
    return response(body)
  })
  await assert.rejects(syncGoogleReminder('t', namespace, reminder), /día límite ya está guardado.*faltó el del día anterior/)
  assert.equal(saved.size, 1)
  failPrevious = false
  assert.equal(await syncGoogleReminder('t', namespace, reminder), 'updated')
  assert.equal(saved.size, 2)
  assert.equal(await syncGoogleReminder('t', namespace, reminder), 'updated')
  assert.equal(saved.size, 2)
})

test('previous-day event crosses month/year, leap-day and daylight-saving boundaries without changing local notification hours', async () => {
  for (const [date, expected] of [
    ['2027-01-01', '2026-12-31'], ['2028-03-01', '2028-02-29'], ['2027-03-01', '2027-02-28'],
    ['2027-03-15', '2027-03-14'], ['2027-11-08', '2027-11-07'],
  ]) {
    const event = await googleEventBody({ ...reminder, date }, namespace, 'previous')
    const start = new Date(event.start.dateTime)
    assert.equal(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`, expected)
    assert.deepEqual(event.reminders.overrides.map((notice) => new Date(start.getTime() - notice.minutes * 60000).getHours()), [9, 14, 21])
    assert.ok(event.reminders.overrides.length <= 5, 'Google allows at most five overrides per event')
  }
})

test('lost insert responses and concurrent conflicts retry the same ID; unrelated and deleted Google events are never overwritten', async (t) => {
  let gets = 0
  let patches = 0
  const existing = { extendedProperties: { private: { saludFinanciera: namespace, sourceKey: reminder.key } } }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'GET') {
      gets++
      const sourceKey = url.endsWith(await googleEventId(namespace, reminder.key)) ? reminder.key : `${reminder.key}:previous`
      return gets === 1 ? response({}, 404) :
        response({ ...existing, extendedProperties: { private: { saludFinanciera: namespace, sourceKey } } })
    }
    if (options.method === 'POST') return response({}, 409)
    patches++
    return response({})
  })
  assert.equal(await syncGoogleReminder('t', namespace, reminder), 'updated')
  assert.equal(patches, 2)
  t.mock.method(globalThis, 'fetch', async () => response({ extendedProperties: { private: { saludFinanciera: 'someone-else' } } }))
  await assert.rejects(syncGoogleReminder('t', namespace, reminder), /no pertenece/)
  t.mock.method(globalThis, 'fetch', async () => response({ status: 'cancelled' }))
  await assert.rejects(syncGoogleReminder('t', namespace, reminder), /papelera/)
  for (const status of [401, 403, 410, 429, 500]) {
    t.mock.method(globalThis, 'fetch', async () => response({}, status))
    await assert.rejects(syncGoogleReminder('t', namespace, reminder), { status })
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  await assert.rejects(syncGoogleReminder('t', namespace, reminder), /internet/)
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('timeout', 'TimeoutError') })
  await assert.rejects(syncGoogleReminder('t', namespace, reminder), /tardó demasiado/)
})

test('OAuth handles denied permissions, blocked/closed popups and missing library without storing access', async (t) => {
  const oauth = googleMock(t)
  assert.equal(await requestGoogleAccess('client'), 'test-only-token')
  oauth.hasGrantedAllScopes = () => false
  await assert.rejects(requestGoogleAccess('client'), /permitir el acceso/)
  googleMock(t, { error: 'access_denied' })
  await assert.rejects(requestGoogleAccess('client'), /no autorizó/)
  googleMock(t, { popup: 'popup_closed' })
  await assert.rejects(requestGoogleAccess('client'), /Cerraste/)
  googleMock(t, { popup: 'popup_failed_to_open' })
  await assert.rejects(requestGoogleAccess('client'), /ventanas emergentes/)
  globalThis.google = null
  await assert.rejects(requestGoogleAccess('client'), /no está lista/)
})

test('preview is refreshed for the selected month, excludes estimated dates and shows missing configuration', async (t) => {
  googleMock(t)
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path) => {
    calls.push(path)
    return response(path.endsWith('google-config') ? { configured: true, clientId: 'client', namespace } :
      { events: [marker, { kind: 'subscription', subscriptionId: 1, date: '2026-11-02', label: 'Referencia', reference: true }] })
  })
  let shown = 0
  const state = {
    ...methods(sync), month, version: 0, renderRoot: { querySelector: () => ({ close() {}, showModal() { shown++ } }) },
  }
  await state.open()
  assert.equal(shown, 1)
  assert.deepEqual(calls, ['/api/calendar/google-config', '/api/calendar?month=2026-11&scope=month'])
  assert.equal(state.events.length, 2)
  assert.ok(!state.selected.has(state.events.find((event) => event.reference).key))
  assert.equal(state.ready, true)
  t.mock.method(globalThis, 'fetch', async () => response({ configured: false }))
  await state.open()
  assert.equal(state.config.configured, false)
  assert.equal(state.ready, false)
  assert.equal(state.events.length, 0)
  const markup = text(state.render())
  assert.match(markup, /GOOGLE_CALENDAR_CLIENT_ID/)
  assert.doesNotMatch(markup, /Autorizo enviar/)
})

function methods(prototype) {
  return Object.fromEntries(Object.getOwnPropertyNames(prototype)
    .filter((name) => typeof prototype[name] === 'function').map((name) => [name, prototype[name]]))
}

test('sync keeps successful results, leaves failed events selected and retries only pending ones', async (t) => {
  googleMock(t)
  const other = prepareGoogleReminders(month, [{ ...marker, loanId: 8 }])[0]
  let fail = true
  const posts = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'GET') return response({}, 404)
    const body = JSON.parse(options.body)
    posts.push(body.extendedProperties.private.sourceKey)
    return response({}, body.extendedProperties.private.sourceKey === other.key && fail ? 500 : 200)
  })
  const state = {
    ...methods(sync), selected: new Set([reminder.key, other.key]), events: [reminder, other], results: {},
    config: { clientId: 'client', namespace }, ready: true, consent: true, version: 0,
  }
  await state.sync()
  assert.equal(state.results[reminder.key].status, 'created')
  assert.equal(state.results[other.key].status, 'error')
  assert.deepEqual([...state.selected], [other.key])
  assert.match(state.notice, /1 recordatorio/)
  assert.match(state.error, /pendientes/)
  assert.equal(state.busy, false)
  assert.equal(state.token, undefined)
  fail = false
  await state.sync()
  assert.deepEqual(posts, [reminder.key, `${reminder.key}:previous`, other.key, other.key, `${other.key}:previous`])
  assert.equal(state.selected.size, 0)
})

test('consent and individual view are required; switching months invalidates a late preview', async (t) => {
  googleMock(t)
  t.mock.method(globalThis, 'fetch', () => assert.fail('Must not contact any API'))
  await sync.sync.call({ ready: true, consent: false, selected: new Set(['a']) })
  await sync.sync.call({ ready: true, consent: true, familyView: true, selected: new Set(['a']) })
  await sync.open.call({ familyView: true })
  let resolve
  t.mock.method(globalThis, 'fetch', () => new Promise((done) => { resolve = done }))
  const state = {
    ...methods(sync), month, version: 0, renderRoot: { querySelector: () => ({ close() {}, showModal() {} }) },
  }
  const pending = state.open()
  state.month = '2026-12'
  state.reset()
  resolve(response({ configured: true, clientId: 'client', namespace }))
  await pending
  assert.equal(state.config, null)
  assert.equal(state.events.length, 0)
  assert.equal(state.ready, false)
  const markup = text(calendar.render.call({
    month, selectedDay: '2026-11-19', lastDay: calendar.lastDay,
    formatMoney: () => '$0', renderMonthlyTable: () => '',
  }))
  assert.match(markup, /<google-calendar-sync .month=2026-11/)
})
