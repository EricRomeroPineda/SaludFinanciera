import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import packageInfo from '../../package.json' with { type: 'json' }

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css?inline')) return { format: 'module', source: 'export default ""', shortCircuit: true }
    if (url.endsWith('.svg')) return { format: 'module', source: 'export default ""', shortCircuit: true }
    return next(url, context)
  },
})
const components = new Map()
globalThis.customElements = { define: (name, component) => components.set(name, component) }
await import('../../src/inicio/inicio.js')
const finance = components.get('salud-financiera').prototype
const family = components.get('family-settings').prototype

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('main menu keeps the finance section, shows the package version and uses the site brand', () => {
  const inicio = components.get('inicio-app').prototype
  const menu = text(inicio.renderMenu.call({
    user: { role: 'usuario' }, renderHeader: () => '', openFinancialSection: () => {},
  }))
  assert.match(menu, /<nav class="section-menu" aria-label="Menú principal">/)
  assert.match(menu, /<strong>Salud financiera<\/strong>/)
  assert.match(menu, new RegExp(`Versión ${packageInfo.version.replaceAll('.', '\\.')}`))
  const header = text(inicio.renderHeader.call({
    activeSection: 'menu', user: { name: 'Ana' }, renderAppearanceToggle: () => '',
    renderThemeToggle: () => '', renderThemePicker: () => '',
  }))
  assert.match(header, /aria-label=lifekit.work/)
  assert.doesNotMatch(header, /Salud <span>Financiera/)
  const financeHeader = text(inicio.renderHeader.call({
    activeSection: 'finance', activeTab: 'overview', user: { name: 'Ana' },
    renderAppearanceToggle: () => '', renderThemeToggle: () => '', renderThemePicker: () => '',
  }))
  assert.match(financeHeader, /aria-label=Salud Financiera/)
  assert.match(financeHeader, /Salud <span>Financiera<\/span>/)
  assert.doesNotMatch(financeHeader, /lifekit<span>/)
  const auth = text(inicio.renderAuth.call({
    authMode: 'login', renderAppearanceToggle: () => '',
  }))
  assert.match(auth, /Salud <span>Financiera<\/span>/)
  assert.match(auth, /BIENESTAR FINANCIERO/)
})

test('profile includes an independent family card with explicit acceptance and no automatic joining', () => {
  const inicio = components.get('inicio-app').prototype
  const profile = text(inicio.renderDashboard.call({
    activeTab: 'profile', renderHeader: () => '', renderProfile: () => 'profile',
  }))
  assert.match(profile, /<family-settings>/)
  const markup = text(family.render.call({ family: null, ready: true }))
  assert.match(markup, /Nombre de la familia/)
  assert.match(markup, /Código de invitación/)
  assert.match(markup, /type="checkbox" required/)
  assert.match(markup, /Acepto compartir/)
})

test('creating and accepting families use the authenticated endpoints and expose errors', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    requests.push({ path, options })
    if (options?.method === 'POST') return new Response(JSON.stringify({ ok: true }))
    return new Response(JSON.stringify({ family: { id: 4, name: 'Luna', members: [] } }))
  })
  const state = { load: family.load }
  await family.perform.call(state, '/join', 'POST', { code: 'a'.repeat(43) }, 'Aceptada')
  assert.equal(requests[0].path, '/api/family/join')
  assert.deepEqual(JSON.parse(requests[0].options.body), { code: 'a'.repeat(43) })
  assert.equal(state.family.id, 4)
  assert.equal(state.busy, false)
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Código vencido' }), { status: 409 }))
  await family.perform.call(state, '/join', 'POST', { code: 'a'.repeat(43) }, 'Aceptada')
  assert.equal(state.error, 'Código vencido')
  assert.equal(state.notice, '')
})

test('changing between individual and family clears selections, forms and previously loaded data', () => {
  let loads = 0
  const state = {
    dashboard: {}, selectedCard: {}, selectedPlan: {}, editingPlan: {},
    showMovementForm: true, showPlanForm: true, showAccountForm: true,
    familyAvailable: true,
    loadDashboard() { loads++ },
  }
  finance.changeView.call(state, { currentTarget: { value: 'family' } })
  assert.equal(state.familyView, true)
  assert.equal(state.dashboard, null)
  assert.equal(state.selectedCard, null)
  assert.equal(state.selectedPlan, null)
  assert.equal(state.showMovementForm, false)
  finance.changeView.call(state, { currentTarget: { value: 'individual' } })
  assert.equal(state.familyView, false)
  assert.equal(loads, 2)
})

test('a late family response cannot replace the subsequently selected individual dashboard', async (t) => {
  let resolveFamily
  t.mock.method(globalThis, 'fetch', (path) => path.endsWith('view=family')
    ? new Promise((resolve) => { resolveFamily = resolve })
    : Promise.resolve(new Response(JSON.stringify({ accounts: [{ name: 'Solo yo' }] }))))
  const state = { familyView: true }
  const pending = finance.refreshDashboard.call(state)
  state.familyView = false
  await finance.refreshDashboard.call(state)
  resolveFamily(new Response(JSON.stringify({ accounts: [{ name: 'Familia' }] })))
  await pending
  assert.equal(state.dashboard.accounts[0].name, 'Solo yo')
})

test('top scope icon replaces the select and announces the special family movement exception', () => {
  const state = {
    loading: true, renderPlanDeleteDialog: () => '', renderMovementDialog: () => '',
    dashboard: null, activeTab: 'overview',
    familyAvailable: true,
  }
  const individual = text(finance.render.call(state))
  assert.match(individual, /finance-topbar/)
  assert.match(individual, /Vista individual\. Cambiar a familiar/)
  assert.doesNotMatch(individual, /<select|family-view-notice/)
  const combined = text(finance.render.call({ ...state, familyView: true }))
  assert.match(combined, /Vista familiar\. Cambiar a individual/)
  assert.match(combined, /class="family-view-notice" role="status"/)
  assert.match(combined, /consulta y movimientos especiales/)
  assert.match(combined, /Registrar movimiento especial/)
  assert.match(combined, /<circle cx="12"/)
  assert.match(combined, /M5 4a3/)
})

test('switching scope is blocked while submitting', () => {
  const state = { submitting: true, familyView: false, loadDashboard: () => assert.fail('Must not switch') }
  finance.changeView.call(state, { currentTarget: { value: 'family' } })
  assert.equal(state.familyView, false)
})

test('users without a family have no scope icon and cannot switch to family', async (t) => {
  const state = {
    loading: true, dashboard: null, activeTab: 'overview',
    renderPlanDeleteDialog: () => '', renderMovementDialog: () => '',
    loadDashboard: () => assert.fail('Must not switch'),
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ family: null })))
  await finance.loadFamilyAvailability.call(state)
  assert.equal(state.familyAvailable, false)
  assert.doesNotMatch(text(finance.render.call(state)), /scope-toggle/)
  finance.changeView.call(state, { currentTarget: { value: 'family' } })
  assert.notEqual(state.familyView, true)
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ family: { id: 4 } })))
  await finance.loadFamilyAvailability.call(state)
  assert.equal(state.familyAvailable, true)
  assert.match(text(finance.render.call(state)), /scope-toggle/)
})

test('family lookup failure is visible and retry restores membership availability', async (t) => {
  const state = {}
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Sin conexión' }), { status: 503 }))
  await finance.loadFamilyAvailability.call(state)
  assert.match(state.familyError, /Sin conexión/)
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ family: { id: 4 } })))
  await finance.loadFamilyAvailability.call(state)
  assert.equal(state.familyError, '')
  assert.equal(state.familyAvailable, true)
})

test('calendar family mode uses authorized family reads and suppresses all movement writes', async (t) => {
  const calendar = components.get('financial-calendar').prototype
  let path
  t.mock.method(globalThis, 'fetch', async (url) => {
    path = url
    return new Response(JSON.stringify({ movements: [] }))
  })
  const state = {
    familyView: true, requestVersion: 0, month: '2026-11', scope: 'all', selectedDay: '2026-11-18',
    lastDay: () => '2026-11-30',
    dispatchEvent: () => assert.fail('Family view must not dispatch writes'),
  }
  await calendar.loadMonth.call(state)
  assert.match(path, /&view=family$/)
  calendar.requestMovement.call(state)
  calendar.movementAction.call(state, 'delete-movement', { id: 7 })
  const markup = text(calendar.renderMonthlyTable.call({
    ...state, data: { movements: [{ id: 7, date: '2026-11-18' }] }, formatMoney: () => '$10',
  }, 'Noviembre'))
  assert.doesNotMatch(markup, />Editar<|>Eliminar</)
  assert.match(markup, /Solo consulta/)
})
