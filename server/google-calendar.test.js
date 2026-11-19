import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleGoogleCalendarRoute } from './google-calendar.js'

const url = new URL('http://127.0.0.1:3001/api/calendar/google-config')
const clientId = '123-test.apps.googleusercontent.com'

function configure(t) {
  for (const [key, value] of Object.entries({
    GOOGLE_CALENDAR_CLIENT_ID: clientId, SESSION_SECRET: 'test-secret-google-calendar-at-least-32-characters',
  })) {
    const original = process.env[key]
    process.env[key] = value
    t.after(() => {
      if (original === undefined) delete process.env[key]
      else process.env[key] = original
    })
  }
}

test('Google config is authenticated, excludes secrets and creates stable user-specific namespaces', async (t) => {
  configure(t)
  let payload
  const helpers = { getUserId: async () => 7, sendJson: (response, status, data) => {
    assert.equal(status, 200)
    payload = data
  } }
  assert.equal(await handleGoogleCalendarRoute({ method: 'GET' }, {}, url, helpers), true)
  const first = payload
  assert.equal(first.clientId, clientId)
  assert.equal(first.configured, true)
  assert.match(first.namespace, /^[a-f0-9]{64}$/)
  assert.deepEqual(Object.keys(first).sort(), ['clientId', 'configured', 'namespace'])
  assert.ok(!JSON.stringify(first).includes(process.env.SESSION_SECRET))
  await handleGoogleCalendarRoute({ method: 'GET' }, {}, url, helpers)
  assert.equal(payload.namespace, first.namespace)
  helpers.getUserId = async () => 8
  await handleGoogleCalendarRoute({ method: 'GET' }, {}, url, helpers)
  assert.notEqual(payload.namespace, first.namespace)
  helpers.getUserId = async () => null
  helpers.sendJson = () => assert.fail('Authentication already sent the rejection')
  assert.equal(await handleGoogleCalendarRoute({ method: 'GET' }, {}, url, helpers), true)
})

test('Google config reports missing setup, rejects family mode and ignores unrelated routes/methods', async (t) => {
  configure(t)
  const helpers = { getUserId: async () => 7, sendJson: (response, status, payload) => {
    assert.deepEqual(payload, { configured: false })
  } }
  process.env.GOOGLE_CALENDAR_CLIENT_ID = ''
  await handleGoogleCalendarRoute({ method: 'GET' }, {}, url, helpers)
  await assert.rejects(handleGoogleCalendarRoute({ method: 'GET' }, {}, new URL(`${url}?view=family`), helpers), { statusCode: 403 })
  assert.equal(await handleGoogleCalendarRoute({ method: 'POST' }, {}, url, helpers), false)
  assert.equal(await handleGoogleCalendarRoute({ method: 'GET' }, {}, new URL('http://localhost/api/calendar'), helpers), false)
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'not-a-client-secret'
  await assert.rejects(handleGoogleCalendarRoute({ method: 'GET' }, {}, url, helpers), /ID de cliente OAuth/)
  process.env.GOOGLE_CALENDAR_CLIENT_ID = clientId
  process.env.SESSION_SECRET = 'short'
  await assert.rejects(handleGoogleCalendarRoute({ method: 'GET' }, {}, url, helpers), /SESSION_SECRET/)
})
