import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css?inline') || url.endsWith('.svg')) return { format: 'module', source: 'export default ""', shortCircuit: true }
    return next(url, context)
  },
})
const components = new Map()
globalThis.customElements = { define: (name, component) => components.set(name, component) }
await import('../../src/inicio/inicio.js')
const image = components.get('card-catalog-image').prototype
const admin = components.get('card-catalog-admin').prototype
const inicio = components.get('inicio-app').prototype
const finance = components.get('salud-financiera').prototype
const { invalidateCardImages } = await import('./card-catalog-image.js')
function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('menu entry and administrative screen are available only to admins, without nested buttons', () => {
  const normal = { user: { role: 'usuario' }, renderHeader: () => '', openFinancialSection: () => {} }
  const markup = text(inicio.renderMenu.call(normal))
  assert.doesNotMatch(markup, /Agregar info de tarjetas nuevas/)
  const administrator = text(inicio.renderMenu.call({ ...normal, user: { role: 'admin' } }))
  assert.match(administrator, /<article class="section-menu-card">/)
  assert.match(administrator, /Agregar info de tarjetas nuevas/)
  assert.match(administrator, /Entrar →/)
  assert.doesNotMatch(administrator, /<button class="section-menu-card"/)
  const blocked = text(inicio.render.call({ ...normal, activeSection: 'card-catalog' }))
  assert.match(blocked, /Solo un administrador/)
  assert.doesNotMatch(blocked, /<card-catalog-admin>/)
  assert.match(text(inicio.render.call({ ...normal, user: { role: 'admin' }, activeSection: 'card-catalog' })), /<card-catalog-admin>/)
})

test('optional image uses 80px square contain styling and is invisible until successfully loaded', () => {
  const styles = components.get('card-catalog-image').styles.cssText
  assert.match(styles, /:host \{ display: none;/)
  assert.match(styles, /:host\(\[loaded\]\)/)
  assert.match(styles, /width: 80px; height: 80px/)
  assert.match(styles, /object-fit: contain/)
  assert.match(styles, /border-radius: 8px/)
  assert.equal(image.render.call({ source: '' }), '')
  let visible = false
  const state = { source: '/api/card-images/1/version.webp', setAttribute: () => { visible = true }, removeAttribute: () => { visible = false } }
  const template = image.render.call(state)
  assert.match(text(template), /width="80" height="80"/)
  const callbacks = template.values.filter((value) => typeof value === 'function')
  callbacks[0]()
  assert.equal(visible, true)
  callbacks[1]()
  assert.equal(visible, false)
  assert.match(text(template), /alt=""/)
})

test('finance card uses a full-card entry button and an independent admin action', () => {
  let entered = 0
  const state = { user: { role: 'admin' }, renderHeader: () => '', openFinancialSection: () => { entered++ } }
  const template = inicio.renderMenu.call(state)
  const markup = text(template)
  assert.match(markup, /section-menu-enter" type="button" aria-label="Entrar a Salud financiera"/)
  assert.match(markup, /class="section-menu-admin-button"/)
  template.values.find((value) => typeof value === 'function')()
  assert.equal(entered, 1)
  const adminAction = template.values.find((value) => value?.strings && text(value).includes('Agregar info de tarjetas nuevas'))
  adminAction.values.find((value) => typeof value === 'function')()
  assert.equal(state.activeSection, 'card-catalog')
  assert.equal(entered, 1)
  for (const role of ['free', 'vip']) {
    assert.doesNotMatch(text(inicio.renderMenu.call({ ...state, user: { role } })), /Agregar info de tarjetas nuevas/)
  }
})

test('resolver requests are shared, unmatched names preserve layout, and lookup failures are retryable', async (t) => {
  invalidateCardImages()
  let calls = 0
  let fail = false
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (fail) return new Response(JSON.stringify({ error: 'Imagen temporalmente no disponible' }), { status: 503 })
    return new Response(JSON.stringify({ imageUrl: null }))
  })
  const state = () => ({ name: 'Sin imagen', type: 'Débito', removeAttribute: () => {} })
  const first = state()
  await Promise.all([image.resolve.call(first), image.resolve.call(state())])
  assert.equal(calls, 1)
  assert.equal(first.source, '')
  assert.equal(first.loaded, false)
  invalidateCardImages()
  await image.resolve.call(first)
  assert.equal(calls, 2)
  fail = true
  invalidateCardImages()
  await image.resolve.call(first)
  assert.equal(first.source, '')
  fail = false
  await image.resolve.call(first)
  assert.equal(calls, 4)
})

test('stale image responses cannot replace a newly selected card', async (t) => {
  invalidateCardImages()
  let release
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('Primera')) return new Promise((resolve) => { release = resolve })
    return new Response(JSON.stringify({ imageUrl: '/segunda.webp' }))
  })
  const state = { name: 'Primera', type: 'Débito', removeAttribute: () => {} }
  const first = image.resolve.call(state)
  state.name = 'Segunda'
  await image.resolve.call(state)
  release(new Response(JSON.stringify({ imageUrl: '/primera.webp' })))
  await first
  assert.equal(state.source, '/segunda.webp')
})

test('family cards resolve original account names, not holder-tagged names, before amounts', () => {
  const methods = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(finance))
    .filter(([, descriptor]) => typeof descriptor.value === 'function').map(([name, descriptor]) => [name, descriptor.value]))
  const state = { ...methods, today: new Date(2026, 6, 1), familyView: true, dashboard: { accounts: [] } }
  const markup = text(finance.renderBankCard.call(state, {
    id: 8, name: 'BBVA · Familiar', catalogName: 'BBVA', type: 'Débito', available: 100,
  }))
  assert.match(markup, /<h3>BBVA · Familiar<\/h3>/)
  assert.match(markup, /<card-catalog-image .name=BBVA .type=Débito>/)
  assert.ok(markup.indexOf('card-catalog-image') < markup.indexOf('Saldo disponible'))
})

test('admin screen checks current session before fetching the shared registry', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url)
    return new Response(JSON.stringify({ user: { role: 'usuario' } }))
  })
  const state = { loadFiles: () => assert.fail('Forbidden user must not browse files') }
  await admin.load.call(state)
  assert.equal(state.allowed, false)
  assert.match(state.error, /Solo un administrador/)
  assert.deepEqual(calls, ['/api/auth/me'])
})

test('editing and alias confirmation require a fresh preview and explicit save', () => {
  const methods = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(admin))
    .filter(([, descriptor]) => typeof descriptor.value === 'function').map(([name, descriptor]) => [name, descriptor.value]))
  const state = { ...methods, draft: { keyword: 'Bbbv' }, preview: { matches: [] }, previewImage: '' }
  state.asAlias({ id: 2, keyword: 'BBVA', scope: 'banco', aliases: [], imageUrl: '/bank.webp' })
  assert.equal(state.draft.id, 2)
  assert.deepEqual(state.draft.aliases, ['Bbbv'])
  assert.equal(state.preview, null)
  assert.match(state.notice, /guarda para confirmarlo/)
  state.preview = { matches: [] }
  state.change({ keyword: 'BBVA nuevo' })
  assert.equal(state.preview, null)
})

test('save without preview is blocked and preserves the draft', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Must preview before saving'))
  const state = { draft: { keyword: 'BBVA' }, preview: null }
  await admin.save.call(state, { preventDefault: () => {} })
  assert.match(state.error, /Revisa las coincidencias/)
  assert.equal(state.draft.keyword, 'BBVA')
})

function catalogState() {
  return {
    allowed: true, search: '', files: [], draft: { keyword: '', scope: 'banco', aliases: [] },
    data: {
      names: [
        { name: 'Pendiente BBVA', type: 'Débito', scope: 'debito', ruleId: null },
        { name: 'Pendiente Renta', type: 'Servicio', scope: 'servicio', ruleId: null },
        { name: 'Asignada BBVA', type: 'Crédito', scope: 'credito', ruleId: 7 },
      ],
      rules: [{ id: 7, keyword: 'BBVA', aliases: [], imageUrl: '/bank.webp' }], suggestions: [],
    },
    renderNameGroups: admin.renderNameGroups,
  }
}

test('catalog separates expanded pending types from collapsed assigned names and saved rules', () => {
  const state = catalogState()
  const markup = text(admin.render.call(state))
  const pending = markup.slice(markup.indexOf('<h3>Pendientes'), markup.indexOf('<details class="assigned-names">'))
  const assigned = markup.slice(markup.indexOf('<details class="assigned-names">'), markup.indexOf('<h2>Nueva regla'))
  assert.match(pending, /Pendientes de imagen \(2\)/)
  assert.match(pending, /<details open><summary>Cuenta de débito \(1\)/)
  assert.match(pending, /<details open><summary>Servicio \(1\)/)
  assert.match(pending, /Pendiente BBVA/)
  assert.match(pending, /Pendiente Renta/)
  assert.doesNotMatch(pending, /Asignada BBVA|Con imagen asignada/)
  assert.match(assigned, /Con imagen registrada \(1\)/)
  assert.match(assigned, /Asignada BBVA/)
  assert.match(assigned, /Modificar imagen \/ regla/)
  assert.doesNotMatch(assigned, /Usar nombre/)
  assert.match(markup, /<details class="saved-rules"><summary>Reglas del catálogo \(1\)/)
  let edited
  state.edit = (rule) => { edited = rule }
  const groups = admin.renderNameGroups.call(state, [state.data.names[2]], true)
  const group = groups.find((value) => value?.strings)
  const row = group.values.find(Array.isArray)[0]
  const button = row.values.find((value) => value?.strings)
  button.values.find((value) => typeof value === 'function')()
  assert.equal(edited, state.data.rules[0])
})

test('catalog search filters both groups and assignment changes move names between them', () => {
  const state = catalogState()
  state.search = 'Renta'
  let markup = text(admin.render.call(state))
  assert.match(markup, /Pendientes de imagen \(1\)/)
  assert.match(markup, /Con imagen registrada \(0\)/)
  assert.doesNotMatch(markup, /<strong>Asignada BBVA<\/strong>/)
  state.search = ''
  state.data.names[0].ruleId = 7
  markup = text(admin.render.call(state))
  assert.match(markup, /Pendientes de imagen \(1\)/)
  assert.match(markup, /Con imagen registrada \(2\)/)
  state.data.names.forEach((entry) => { entry.ruleId = null })
  markup = text(admin.render.call(state))
  assert.match(markup, /Pendientes de imagen \(3\)/)
  assert.match(markup, /Con imagen registrada \(0\)/)
  state.data.names.forEach((entry) => { entry.ruleId = 7 })
  assert.match(text(admin.render.call(state)), /No hay nombres pendientes de imagen/)
})

test('header shows account role independently of the greeting and management is admin only', () => {
  for (const [role, label] of [['free', 'Free'], ['vip', 'VIP'], ['admin', 'Admin']]) {
    const state = {
      user: { id: 7, name: 'Ana', role }, activeSection: 'menu',
      renderHeader: () => '', renderAppearanceToggle: () => '', renderThemeToggle: () => '', renderThemePicker: () => '',
    }
    const header = text(inicio.renderHeader.call(state))
    assert.ok(header.includes(`aria-label=Tipo de cuenta: ${label}`))
    assert.match(header, /class="user-role-badge"/)
    const menu = text(inicio.renderMenu.call(state))
    assert.equal(menu.includes('Gestión de cuentas'), role === 'admin')
    const management = text(inicio.render.call({ ...state, activeSection: 'user-management' }))
    assert.equal(management.includes('<user-management'), role === 'admin')
  }
})

test('management lists roles, protects ID 2 and reports save failures without success', async (t) => {
  const management = components.get('user-management').prototype
  const markup = text(management.render.call({
    users: [{ id: 2, name: 'Principal', role: 'admin' }, { id: 7, name: 'Ana', role: 'free' }],
    search: '', busy: false,
  }))
  assert.match(markup, /Administrador protegido/)
  assert.match(markup, /value=vip/)
  const originalFormData = globalThis.FormData
  t.mock.method(globalThis, 'FormData', function () { return { get: () => 'vip' } })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Sin permiso' }), { status: 403 }))
  const state = { users: [{ id: 7, role: 'free' }], dispatchEvent: () => assert.fail('No success event on failure') }
  await management.save.call(state, { preventDefault: () => {}, currentTarget: {} }, { id: 7, name: 'Ana' })
  assert.equal(state.error, 'Sin permiso')
  assert.equal(state.notice, '')
  assert.equal(state.users[0].role, 'free')
  assert.ok(originalFormData)
})
