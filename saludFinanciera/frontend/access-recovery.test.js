import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css?inline')) return { format: 'module', source: 'export default ""', shortCircuit: true }
    return next(url, context)
  },
})
const components = new Map()
globalThis.customElements = { define: (name, component) => components.set(name, component) }
await import('../../src/inicio/access-recovery.js')
const methods = components.get('access-recovery').prototype
const emailMethods = components.get('email-settings').prototype

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('new password field is absent until the server validates email and recovery key', () => {
  const first = text(methods.render.call({}))
  assert.match(first, /name="email" type="email"/)
  assert.match(first, /name="recoveryKey"/)
  assert.doesNotMatch(first, /name="password"|<email-settings/)
  assert.match(first, /Recuperar contraseña por correo/)
  assert.match(first, /Recuperar palabra clave por correo/)
  const second = text(methods.render.call({ token: 'a'.repeat(64) }))
  assert.match(second, /<email-settings .purpose=reset-password/)
  assert.doesNotMatch(second, /name="email"|name="recoveryKey"/)
  const passwordForm = text(emailMethods.render.call({ purpose: 'reset-password', eye: () => '' }))
  assert.match(passwordForm, /name="password"/)
  assert.doesNotMatch(passwordForm, /name="recoveryKey"/)
})

for (const purpose of [undefined, 'reset-password', 'reset-recovery']) {
  test(`recovery sends only the fields required for ${purpose || 'key validation'}`, async (t) => {
    t.mock.method(globalThis, 'FormData', function () { return new Map([['email', 'ana@example.com'], ['recoveryKey', 'private-key']]) })
    let request
    t.mock.method(globalThis, 'fetch', async (path, options) => {
      request = { path, body: JSON.parse(options.body) }
      return new Response(JSON.stringify(purpose ? { message: 'Si el correo está registrado…' } : { token: 'a'.repeat(64) }))
    })
    let countdown = false
    let reset = false
    const form = { querySelector: () => ({ reportValidity: () => true }), reportValidity: () => true, reset() { reset = true } }
    const state = { countdown() { countdown = true } }
    await methods.submit.call(state, { preventDefault() {}, currentTarget: form }, purpose)
    assert.equal(state.error, '')
    assert.equal(state.busy, false)
    assert.equal(request.path, `/api/auth/email/${purpose ? 'request-access-link' : 'validate-recovery-key'}`)
    assert.deepEqual(request.body, purpose ? { email: 'ana@example.com', purpose } : { email: 'ana@example.com', recoveryKey: 'private-key' })
    assert.equal(countdown, Boolean(purpose))
    assert.equal(reset, !purpose)
    if (!purpose) assert.equal(state.token, 'a'.repeat(64))
  })
}

test('failed validation never reveals password form', async (t) => {
  t.mock.method(globalThis, 'FormData', function () { return new Map([['email', 'ana@example.com'], ['recoveryKey', 'wrong-key']]) })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'El correo o la palabra clave no son correctos.' }), { status: 400 }))
  const form = { querySelector: () => ({ reportValidity: () => true }), reportValidity: () => true }
  const state = {}
  await methods.submit.call(state, { preventDefault() {}, currentTarget: form })
  assert.equal(state.token, undefined)
  assert.match(state.error, /no son correctos/)
  assert.equal(state.busy, false)
})
