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
const validated = () => ({
  email: 'ana@example.com', verifiedEmail: 'ana@example.com', useKey: true, generation: 0,
  icon: methods.icon, help: methods.help,
})

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('new password field is absent until the server validates email and recovery key', () => {
  const first = text(methods.render.call({ icon: methods.icon }))
  assert.match(first, /name="email" type="email"/)
  assert.doesNotMatch(first, /name="accessRecoveryKey"|name="password"|<email-settings|Recuperar contraseña por correo/)
  const checked = text(methods.render.call(validated()))
  assert.match(checked, /name="accessRecoveryKey".*autocomplete="new-password"/)
  assert.match(checked, /\.value= required/)
  assert.match(checked, /aria-label="Editar correo"/)
  assert.match(checked, /Información: Recuperar contraseña por correo/)
  assert.match(checked, /Recuperar palabra clave por correo/)
  const second = text(methods.render.call({ token: 'a'.repeat(64) }))
  assert.match(second, /<email-settings .purpose=reset-password/)
  assert.doesNotMatch(second, /name="email"|name="recoveryKey"/)
  const passwordForm = text(emailMethods.render.call({ purpose: 'reset-password', eye: () => '' }))
  assert.match(passwordForm, /name="password"/)
  assert.doesNotMatch(passwordForm, /name="recoveryKey"/)
})

for (const purpose of [undefined, 'reset-password', 'reset-recovery']) {
  test(`recovery sends only the fields required for ${purpose || 'key validation'}`, async (t) => {
    t.mock.method(globalThis, 'FormData', function () { return new Map([['accessRecoveryKey', 'private-key']]) })
    let request
    t.mock.method(globalThis, 'fetch', async (path, options) => {
      request = { path, body: JSON.parse(options.body) }
      return new Response(JSON.stringify(purpose ? { message: 'Si el correo está registrado…' } : { token: 'a'.repeat(64) }))
    })
    let countdown = false
    let reset = false
    const form = { querySelector: () => ({ reportValidity: () => true }), reportValidity: () => true, reset() { reset = true } }
    const state = { ...validated(), countdown() { countdown = true } }
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
  t.mock.method(globalThis, 'FormData', function () { return new Map([['accessRecoveryKey', 'wrong-key']]) })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'El correo o la palabra clave no son correctos.' }), { status: 400 }))
  const form = { querySelector: () => ({ reportValidity: () => true }), reportValidity: () => true }
  const state = validated()
  await methods.submit.call(state, { preventDefault() {}, currentTarget: form })
  assert.equal(state.token, undefined)
  assert.match(state.error, /no son correctos/)
  assert.equal(state.busy, false)
})

test('checking the email normalizes and locks only a confirmed address', async (t) => {
  let request
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    request = { path, body: JSON.parse(options.body) }
    return new Response(JSON.stringify({ ok: true, email: 'ana@example.com' }))
  })
  const state = { generation: 0 }
  await methods.checkEmail.call(state, {
    preventDefault() {}, currentTarget: {
      reportValidity: () => true, querySelector: () => ({ value: ' Ana@Example.com ' }),
    },
  })
  assert.deepEqual(request, { path: '/api/auth/email/check-recovery-email', body: { email: 'ana@example.com' } })
  assert.equal(state.verifiedEmail, 'ana@example.com')
  assert.equal(state.email, state.verifiedEmail)
  assert.equal(state.useKey, false)
})

test('editing email invalidates all displayed recovery choices and permissions', async () => {
  const state = { ...validated(), token: 'secret', error: 'old', notice: 'sent', updateComplete: Promise.resolve(), renderRoot: { querySelector: () => null } }
  methods.editEmail.call(state)
  assert.equal(state.verifiedEmail, '')
  assert.equal(state.token, '')
  assert.equal(state.useKey, false)
  assert.doesNotMatch(text(methods.render.call(state)), /Recuperar contraseña por correo|name="accessRecoveryKey"/)
})

test('a late email check cannot restore options after editing the address', async (t) => {
  let finish
  t.mock.method(globalThis, 'fetch', () => new Promise((resolve) => { finish = resolve }))
  const state = { generation: 0, updateComplete: Promise.resolve(), renderRoot: { querySelector: () => null } }
  const request = methods.checkEmail.call(state, {
    preventDefault() {}, currentTarget: { reportValidity: () => true, querySelector: () => ({ value: 'ana@example.com' }) },
  })
  methods.editEmail.call(state)
  finish(new Response(JSON.stringify({ email: 'ana@example.com' })))
  await request
  assert.equal(state.verifiedEmail, '')
  assert.equal(state.busy, false)
})
