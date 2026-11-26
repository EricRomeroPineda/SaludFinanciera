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
      ['name', 'Ana'], ['password', 'long-test-password'], ['recoveryKey', 'private-key'], ['photoUrl', photo],
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

test('profile saves only photo and theme without recovery key fields', async (t) => {
  t.mock.method(globalThis, 'FormData', function () { return new Map([['photoUrl', photo]]) })
  let payload
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    payload = JSON.parse(options.body)
    return new Response(JSON.stringify({ user: { id: 7, photo, theme: 'verde' } }))
  })
  const state = { user: { id: 7, theme: 'verde' } }
  await handlers.handleProfileSubmit.call(state, { preventDefault() {}, currentTarget: {} })
  assert.deepEqual(payload, { photo, theme: 'verde' })
  assert.equal(state.notice, 'Perfil guardado.')
  const markup = handlers.renderProfile.call({ renderPhotoFields: () => '', photoDraft: photo }).strings.join('')
  assert.doesNotMatch(markup, /name="recoveryKey"|name="currentPassword"|showProfileSecrets/)
})

test('changing theme never resends the profile photo', async (t) => {
  let request
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    request = { path, options }
    return new Response(JSON.stringify({ user: { id: 7, photo, theme: 'oscuro' } }))
  })

  const state = { user: { id: 7, photo, theme: 'verde' } }
  await handlers.handleThemeChange.call(state, { currentTarget: { value: 'oscuro' } })
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
  const state = { user: { name: 'Eric', photo }, brokenPhoto: false, renderAppearanceToggle: () => '', renderThemeToggle: () => '', renderThemePicker: () => '' }
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

test('the profile beside logout displays the current user name and corresponding photo', () => {
  for (const user of [
    { name: 'Eric', photo: 'https://example.com/eric.jpg' },
    { name: 'Ana', photo: 'https://example.com/ana.jpg' },
  ]) {
    const header = handlers.renderHeader.call({ user, brokenPhoto: false, renderAppearanceToggle: () => '', renderThemeToggle: () => '', renderThemePicker: () => '' })
    const markup = header.strings.join('')
    assert.ok(header.values.includes(user.photo))
    assert.ok(header.values.includes(user.name))
    assert.ok(header.values.includes(`Abrir perfil de ${user.name}`))
    assert.match(markup, /user-profile-button[\s\S]*profile-photo[\s\S]*user-greeting[\s\S]*<\/button>[\s\S]*Cerrar sesión/)
  }
})

test('day and night persist per user independently of the color theme', async (t) => {
  const requests = []
  let state
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    const body = JSON.parse(options.body)
    requests.push({ path, body })
    return new Response(JSON.stringify({ user: { ...state.user, appearance: body.appearance } }))
  })
  const effectiveAppearance = Object.getOwnPropertyDescriptor(handlers, 'effectiveAppearance').get
  for (const theme of ['verde', 'azul', 'violeta', 'oscuro']) {
    state = { user: { theme }, appearance: null }
    Object.defineProperty(state, 'effectiveAppearance', { get: () => effectiveAppearance.call(state) })
    const initial = theme === 'oscuro' ? 'night' : 'day'
    assert.equal(state.effectiveAppearance, initial)
    await handlers.toggleAppearance.call(state)
    assert.equal(state.effectiveAppearance, initial === 'night' ? 'day' : 'night')
    assert.equal(state.user.theme, theme)
    await handlers.toggleAppearance.call(state)
    assert.equal(state.effectiveAppearance, initial)
    assert.equal(state.user.theme, theme)
  }
  assert.equal(requests.length, 8)
  assert.ok(requests.every(({ path, body }) => path === '/api/auth/theme' && Object.keys(body).join() === 'appearance'))
})

test('saved appearance is restored and failed saves do not claim a mode or color change', async (t) => {
  const effective = Object.getOwnPropertyDescriptor(handlers, 'effectiveAppearance').get
  const state = { user: { theme: 'azul', appearance: 'night' }, appearance: null, showThemePicker: true }
  Object.defineProperty(state, 'effectiveAppearance', { get: () => effective.call(state) })
  assert.equal(state.effectiveAppearance, 'night')
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Sin conexión' }), { status: 503 }))
  await handlers.toggleAppearance.call(state)
  assert.equal(state.effectiveAppearance, 'night')
  assert.equal(state.savingTheme, false)
  assert.equal(state.styleError, 'Sin conexión')
  await handlers.handleThemeChange.call(state, { currentTarget: { value: 'violeta' } })
  assert.equal(state.user.theme, 'azul')
  assert.equal(state.showThemePicker, true)
  assert.equal(state.styleError, 'Sin conexión')
})

test('the color selector lives in a header dialog, not the profile form', () => {
  const flatten = (value) => Array.isArray(value) ? value.map(flatten).join('')
    : value?.strings ? value.strings.reduce((output, part, index) => output + part + flatten(value.values[index]), '')
      : value == null || typeof value === 'function' ? '' : String(value)
  const toggle = flatten(handlers.renderThemeToggle.call({}))
  assert.match(toggle, /aria-label="Elegir color del tema"/)
  assert.match(toggle, /aria-haspopup="dialog"/)
  const picker = flatten(handlers.renderThemePicker.call({ user: { theme: 'azul' } }))
  assert.match(picker, /<dialog id="theme-picker"/)
  for (const color of ['Verde', 'Azul', 'Violeta', 'Oscuro']) assert.ok(picker.includes(color))
  const profile = flatten(handlers.renderProfile.call({ user: { name: 'Ana' }, renderPhotoFields: () => '' }))
  assert.doesNotMatch(profile, /theme-label|<select|Color del tema/)
})

test('finance module owns its navigation and loans outside the orchestrator', () => {
  const Finance = components.get('salud-financiera')
  assert.ok(Finance)
  assert.equal(handlers.renderMovements, undefined)
  assert.equal(typeof Finance.prototype.renderMovements, 'function')
  const state = {
    activeTab: 'debtors',
    dashboard: { loans: [], accounts: [] },
    renderActiveTab: () => 'debtors-content',
    renderPlanDeleteDialog: () => '',
    renderMovementDialog: () => '',
  }
  const template = Finance.prototype.render.call(state)
  const text = (value) => Array.isArray(value) ? value.map(text).join(' ')
    : value?.strings ? `${value.strings.join(' ')} ${value.values.map(text).join(' ')}`
      : value?.values ? value.values.map(text).join(' ')
      : typeof value === 'string' ? value : ''
  const markup = text(template)
  for (const label of ['Panorama', 'Tarjetas', 'Planes futuros', 'Movimiento', 'Suscripciones', 'Deudores']) {
    assert.ok(markup.includes(label))
  }
  assert.ok(markup.includes('debtors-content'))
  assert.ok(!markup.includes('>Cuentas<'))
  assert.ok(!markup.includes('Calendario'))
  assert.ok(!markup.includes('Mi perfil'))
  const loans = text(Finance.prototype.renderDebtors.call(state))
  assert.ok(loans.includes('finance-loans'))
})
