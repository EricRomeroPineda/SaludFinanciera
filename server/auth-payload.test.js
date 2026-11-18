import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

// Load the browser component without a DOM to exercise its actual request handlers.
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css?inline')) {
      return { format: 'module', source: 'export default ""', shortCircuit: true }
    }
    if (url.endsWith('/default-avatar.svg')) {
      return { format: 'module', source: 'export default "/default-avatar.svg"', shortCircuit: true }
    }
    return next(url, context)
  },
})
const components = new Map()
globalThis.customElements = { define: (name, component) => components.set(name, component) }
await import('../src/inicio/inicio.js')
const handlers = components.get('inicio-app').prototype
const photo = 'https://example.com/avatar.png'

for (const mode of ['login', 'register', 'recover']) {
  test(`${mode} sends only its required fields with a photo URL draft`, async (t) => {
    const fields = new Map([
      ['name', 'Ana'], ['password', 'long-test-password'], ['recoveryKey', 'private-key'],
    ])
    t.mock.method(globalThis, 'FormData', function () { return fields })
    let request
    t.mock.method(globalThis, 'fetch', async (path, options) => {
      request = { path, options }
      return new Response(JSON.stringify(mode === 'recover'
        ? { ok: true }
        : { user: { id: 7, name: 'Ana', photo, theme: 'verde' } }))
    })
    const state = {
      authMode: mode,
      photoDraft: photo,
      refreshDashboard: async () => {},
      setAuthMode(value) { this.authMode = value },
    }
    await handlers.handleAuthSubmit.call(state, { preventDefault() {}, currentTarget: {} })
    assert.equal(state.error, '')
    assert.equal(state.submitting, false)
    if (mode !== 'recover') assert.equal(state.activeSection, 'menu')
    assert.equal(request.path, `/api/auth/${mode}`)
    const expected = { name: 'Ana', password: 'long-test-password' }
    if (mode === 'register') expected.photo = photo
    if (mode !== 'login') expected.recoveryKey = 'private-key'
    assert.deepEqual(JSON.parse(request.options.body), expected)
    assert.ok(Buffer.byteLength(request.options.body) < 16 * 1024)
  })
}

test('changing theme never resends the profile photo', async (t) => {
  let request
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    request = { path, options }
    return new Response(JSON.stringify({ user: { id: 7, photo, theme: 'oscuro' } }))
  })

  const state = { user: { id: 7, photo, theme: 'verde' } }
  await handlers.handleThemeChange.call(state, { target: { value: 'oscuro' } })
  assert.equal(state.error, '')
  assert.equal(state.user.theme, 'oscuro')
  assert.equal(request.path, '/api/auth/theme')
  assert.deepEqual(JSON.parse(request.options.body), { theme: 'oscuro' })
  assert.ok(Buffer.byteLength(request.options.body) < 16 * 1024)
})

test('photo form accepts only a URL and enforces the database column length', () => {
  const template = handlers.renderPhotoFields.call({ photoDraft: '', submitting: false })
  const markup = template.strings.join('')
  assert.ok(markup.includes('type="url"'))
  assert.ok(markup.includes('maxlength="500" required'))
  assert.ok(!markup.includes('type="file"'))
})

test('authenticated users see the menu before the financial dashboard', () => {
  const state = {
    user: { id: 7 }, activeSection: 'menu',
    renderMenu: () => 'menu', renderDashboard: () => 'dashboard', renderAuth: () => 'login',
  }
  assert.equal(handlers.render.call(state), 'menu')
  handlers.openFinancialSection.call(state)
  assert.equal(state.activeTab, 'overview')
  assert.equal(handlers.render.call(state), 'dashboard')
  state.activeSection = 'menu'
  assert.equal(handlers.render.call(state), 'menu')
  state.user = null
  assert.equal(handlers.render.call(state), 'login')
})

test('restored sessions land on the menu', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ user: { id: 7, photo } })))
  const state = { activeSection: 'finance', refreshDashboard: async () => {} }
  await handlers.restoreSession.call(state)
  assert.equal(state.activeSection, 'menu')
  assert.equal(state.user.photo, photo)
  assert.equal(state.loading, false)
})

test('the shared header uses the saved photo or a default image instead of an initial', () => {
  const state = { user: { name: 'Eric', photo }, brokenPhoto: false }
  const header = handlers.renderHeader.call(state)
  assert.ok(header.values.includes(photo))
  assert.ok(header.strings.join('').includes('<img class="profile-photo"'))
  assert.ok(!header.strings.join('').includes('avatar-placeholder'))
  state.brokenPhoto = true
  assert.ok(handlers.renderHeader.call(state).values.includes('/default-avatar.svg'))
  state.user.photo = null
  state.brokenPhoto = false
  assert.ok(handlers.renderHeader.call(state).values.includes('/default-avatar.svg'))
  handlers.openFinancialSection.call(state, 'profile')
  assert.equal(state.activeTab, 'profile')
  assert.equal(state.activeSection, 'finance')
})
