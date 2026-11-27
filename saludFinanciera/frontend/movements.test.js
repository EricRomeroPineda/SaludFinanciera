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
await import('./salud-financiera.js')
const finance = components.get('salud-financiera').prototype
const calendar = components.get('financial-calendar').prototype
const subscriptions = components.get('finance-subscriptions').prototype
const methods = (prototype) => Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(prototype))
  .filter(([, descriptor]) => typeof descriptor.value === 'function')
  .map(([name, descriptor]) => [name, descriptor.value]))
const movement = {
  id: 11, date: '2026-11-18', amount: '100.00', originAccountId: 2,
  originAccount: 'Débito', planId: 8, planName: 'Viaje', categoryId: 4, category: 'Ahorro', categoryType: 'gasto',
}
const dashboard = () => ({
  accounts: [{ id: 2, name: 'Débito', available: '1000' }, { id: 3, name: 'Crédito', available: '500' }],
  categories: [{ id: 4, name: 'Ahorro', type: 'gasto' }],
  plans: [{ id: 8, name: 'Viaje' }], subscriptions: [{ id: 9, name: 'Internet' }],
  loans: [],
  movements: [], summary: {},
})
const financeState = (changes = {}) => ({
  ...methods(finance), dashboard: dashboard(), error: '', submitting: false,
  activeTab: 'movements', movementOperation: 'expense', ...changes,
})
const calendarState = (changes = {}) => ({
  ...methods(calendar), month: '2026-11', selectedDay: '2026-11-18',
  data: { days: [{ day: '2026-11-18', count: 1, income: 0, expenses: 100 }], movements: [movement],
    categories: [], events: [{ kind: 'plan', date: '2026-11-18', label: 'Viaje', planId: 8, amount: 100 }] },
  error: '', loading: false, requestVersion: 0, scope: 'all', ...changes,
})

test('subscription card registers a linked expense with its cost and today as editable defaults', () => {
  const item = { id: 9, name: 'Internet', cost: '250.50', frequency: 'Mensual',
    status: 'activa', annualCost: '3006', monetized: '0' }
  const events = []
  const state = { familyView: false, submitting: false, dispatchEvent: (event) => events.push(event) }
  subscriptions.registerMovement.call(state, item)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'register-subscription-movement')
  assert.equal(events[0].detail, item)
  assert.equal(events[0].bubbles, true)
  assert.equal(events[0].composed, true)
  subscriptions.registerMovement.call({ ...state, familyView: true }, item)
  subscriptions.registerMovement.call({ ...state, submitting: true }, item)
  assert.equal(events.length, 1)

  const ctx = financeState({ movementMode: 'investment', movementOperation: 'transfer',
    editingMovement: { id: 12 }, newMovementDefaults: { planId: 8 } })
  assert.match(text(ctx.renderActiveTab.call({ activeTab: 'subscriptions' })),
    /@register-subscription-movement=/)
  ctx.startSubscriptionMovement(item)
  assert.equal(ctx.activeTab, 'movements')
  assert.equal(ctx.showMovementForm, true)
  assert.equal(ctx.editingMovement, null)
  assert.equal(ctx.movementMode, 'subscription')
  assert.equal(ctx.movementOperation, 'expense')
  assert.deepEqual(ctx.newMovementDefaults, {
    date: ctx.newMovementDefaults.date, amount: '250.50', subscriptionId: 9, subscriptionName: 'Internet',
  })
  assert.match(ctx.newMovementDefaults.date, /^\d{4}-\d{2}-\d{2}$/)
  const markup = text(ctx.renderMovementForm())
  assert.match(markup, /name="subscriptionId" required .value=9/)
  assert.match(markup, /name="amount"[^>]*.value=250.50/)
  assert.match(markup, /monto sugerido es su costo por cobro/)
  assert.doesNotMatch(markup, /<select\s+name="operation"|name="planId"/)
  const blocked = financeState({ familyView: true, showMovementForm: false })
  blocked.startSubscriptionMovement(item)
  assert.equal(blocked.showMovementForm, false)
  assert.equal(blocked.activeTab, 'movements')
})

test('credit card payment preloads the interest-free amount only when available', () => {
  const ctx = financeState()
  ctx.startCardPayment({ id: 3, name: 'Crédito', paymentToAvoidInterest: '180.25' })
  assert.equal(ctx.movementMode, 'normal')
  assert.equal(ctx.movementOperation, 'transfer')
  assert.deepEqual(ctx.newMovementDefaults, {
    destinationAccountId: 3, cardName: 'Crédito', amount: '180.25',
  })
  assert.match(text(ctx.renderMovementForm()), /name="amount"[^>]*.value=180.25/)
  assert.match(text(ctx.renderMovementForm()), /monto sugerido es el pago para no generar intereses/)
  ctx.startCardPayment({ id: 3, name: 'Crédito', paymentToAvoidInterest: null })
  assert.equal(ctx.newMovementDefaults.amount, null)
  assert.match(text(ctx.renderMovementForm()), /name="amount"[^>]*.value= required/)
})
function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  if (value?.values) return text(value.values)
  return value == null || typeof value === 'function' || typeof value === 'object' ? '' : String(value)
}

test('Movement is next to Panorama and hosts the calendar instead of the truncated dashboard history', () => {
  const ctx = financeState()
  const markup = text(ctx.render()).split('<nav')[1].split('</nav>')[0]
  assert.ok(markup.indexOf('Panorama') < markup.indexOf('Movimiento'))
  assert.ok(markup.indexOf('Movimiento') < markup.indexOf('Tarjetas'))
  const panel = text(ctx.renderMovements())
  assert.match(panel, /financial-calendar/)
  assert.match(panel, /Registrar categoría/)
  assert.doesNotMatch(panel, /movement-list|movement-form/)
})

test('calendar shows a colored legend, real daily counts, scheduled items and a complete monthly table', () => {
  const markup = text(calendarState().render())
  for (const expected of ['Leyenda de colores', 'event-dot card', 'event-dot plan', 'event-dot subscription',
    '1 movimiento en este día', 'Programado para este día', 'Registrar movimiento en este día',
    'Registro general', 'Viaje', 'Editar', 'Eliminar']) {
    assert.ok(markup.includes(expected), expected)
  }
  assert.match(markup, /solo movimientos registrados/)
  assert.match(markup, /<th>Plan<\/th>/)
})

test('monthly table retains more than 250 movements and empty/error/loading states are distinct', () => {
  const ctx = calendarState()
  ctx.data.movements = Array.from({ length: 301 }, (_, index) => ({ ...movement, id: index + 1 }))
  assert.equal((text(ctx.renderMonthlyTable('noviembre')).match(/Ver movimientos del 2026-11-18/g) || []).length, 301)
  assert.match(text(calendarState({ data: { movements: [] } }).renderMonthlyTable('noviembre')), /No hay movimientos registrados/)
  const error = text(calendarState({ error: 'Falló la consulta' }).render())
  assert.match(error, /Falló la consulta/)
  assert.match(error, /Reintentar/)
  assert.doesNotMatch(error, /0 movimientos registrados en este día/)
  const loading = text(calendarState({ loading: true, data: null }).render())
  assert.match(loading, /Cargando calendario/)
  assert.doesNotMatch(loading, /Sin movimientos registrados en este día/)
})

test('calendar dispatches registration with the selected date and optional scheduled relationship', () => {
  const events = []
  const ctx = calendarState({ dispatchEvent: (event) => events.push(event) })
  ctx.requestMovement()
  assert.equal(events[0].type, 'register-movement')
  assert.deepEqual(events[0].detail, { date: '2026-11-18', event: null })
  const scheduled = ctx.data.events[0]
  ctx.requestMovement(scheduled)
  assert.deepEqual(events[1].detail, { date: '2026-11-18', event: scheduled })
  ctx.movementAction('edit-movement', movement)
  assert.equal(events[2].detail, movement)
})

test('month navigation changes both calendar and monthly query and clamps the selected day', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path) => {
    calls.push(path)
    return new Response(JSON.stringify({ days: [], movements: [], categories: [], events: [] }))
  })
  const ctx = calendarState({ month: '2026-02', selectedDay: '2026-01-31' })
  await ctx.loadMonth()
  assert.equal(ctx.selectedDay, '2026-02-28')
  assert.equal(calls[0], '/api/calendar?month=2026-02&scope=all')
  let reloaded = 0
  ctx.loadMonth = () => { reloaded++ }
  ctx.changeMonth(-1)
  assert.equal(ctx.month, '2026-01')
  ctx.changeMonth(1)
  assert.equal(ctx.month, '2026-02')
  assert.equal(reloaded, 2)
})

test('refresh reloads the same visible month and stale responses cannot overwrite a newer month', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', (path) => new Promise((resolve) => requests.push({ path, resolve })))
  const ctx = calendarState()
  const first = ctx.loadMonth()
  ctx.month = '2026-12'
  const second = ctx.loadMonth()
  requests[1].resolve(new Response(JSON.stringify({ month: '2026-12', movements: [] })))
  await second
  requests[0].resolve(new Response(JSON.stringify({ month: '2026-11', movements: [movement] })))
  await first
  assert.equal(ctx.data.month, '2026-12')
  assert.equal(ctx.selectedDay, '2026-12-18')
  assert.equal(ctx.loading, false)
  let reloaded = 0
  ctx.loadMonth = () => { reloaded++ }
  ctx.updated(new Map([['revision', {}]]))
  assert.equal(reloaded, 1)
  assert.equal(ctx.month, '2026-12')
})

test('calendar errors do not look like successfully loaded empty months', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'No disponible' }), { status: 500 }))
  const ctx = calendarState()
  await ctx.loadMonth()
  assert.equal(ctx.error, 'No disponible')
  assert.equal(ctx.data, null)
  assert.equal(ctx.loading, false)
})

test('register defaults to all records and allows annual/monthly views explicitly', () => {
  const ctx = calendarState()
  const markup = text(ctx.renderMonthlyTable('noviembre'))
  assert.match(markup, /Registro general · Todos los registros/)
  assert.match(markup, /Año seleccionado/)
  assert.match(markup, /Mes seleccionado/)
  ctx.scope = 'year'
  assert.match(text(ctx.renderMonthlyTable('noviembre')), /Registro general · Año 2026/)
  ctx.scope = 'month'
  assert.match(text(ctx.renderMonthlyTable('noviembre')), /Registro general · noviembre/)
})

test('selecting a record date navigates to its saved day/month/year and year selection reloads', () => {
  let reloaded = 0
  const ctx = calendarState({ loadMonth: () => { reloaded++ } })
  ctx.showMovementDate('2025-03-16')
  assert.equal(ctx.selectedDay, '2025-03-16')
  assert.equal(ctx.month, '2025-03')
  assert.equal(reloaded, 1)
  ctx.selectYear({ currentTarget: { value: '2024', setCustomValidity: () => {} } })
  assert.equal(ctx.month, '2024-03')
  assert.equal(reloaded, 2)
})

for (const kind of ['plan', 'subscription', 'card']) {
  test(`scheduled ${kind} opens a modal draft with the correct date, operation and relationship`, () => {
    const ctx = financeState()
    ctx.openCalendarMovement({
      date: '2026-12-09',
      event: { kind, planId: kind === 'plan' ? 8 : null, subscriptionId: kind === 'subscription' ? 9 : null,
        destinationAccountId: kind === 'card' ? 3 : null, label: 'Programado', amount: '100.00' },
    })
    assert.equal(ctx.showMovementForm, true)
    assert.equal(ctx.movementOperation, kind === 'card' ? 'transfer' : 'expense')
    assert.equal(ctx.movementMode, kind === 'plan' ? 'investment' : kind === 'subscription' ? 'subscription' : 'normal')
    const markup = text(ctx.renderMovementForm())
    assert.match(markup, /name="date" type="date" .value=2026-12-09/)
    assert.match(markup, /name="amount"[^>]*.value=100.00/)
    assert.ok(markup.includes(kind === 'plan' ? 'name="planId" required .value=8'
      : kind === 'subscription' ? 'name="subscriptionId" required .value=9' : 'name="destinationAccountId" required .value=3'))
  })
}

test('movement form lives inside a dialog and native modal open/close tracks state', () => {
  const dialog = { open: false, showModal() { this.open = true }, close() { this.open = false } }
  const ctx = financeState({ showMovementForm: true, renderRoot: { querySelector: () => dialog } })
  assert.match(text(ctx.renderMovementDialog()), /<dialog id="movement-dialog"/)
  assert.match(text(ctx.renderMovementDialog()), /<form class="movement-form"/)
  ctx.updated(new Map([['showMovementForm', false]]))
  assert.equal(dialog.open, true)
  ctx.submitting = true
  ctx.closeMovementDialog()
  assert.equal(ctx.showMovementForm, true)
  ctx.submitting = false
  ctx.closeMovementDialog()
  ctx.updated(new Map([['showMovementForm', true]]))
  assert.equal(dialog.open, false)
  assert.equal(ctx.newMovementDefaults, null)
})

test('monthly editing retains all original movement IDs and infers the operation', () => {
  const ctx = financeState()
  ctx.startMovementEdit(movement)
  assert.equal(ctx.movementOperation, 'expense')
  assert.equal(ctx.movementMode, 'investment')
  assert.equal(ctx.editingMovement.planId, 8)
  assert.equal(ctx.editingMovement.originAccountId, 2)
  assert.equal(ctx.showMovementForm, true)
  ctx.startMovementEdit({ ...movement, destinationAccountId: 3 })
  assert.equal(ctx.movementOperation, 'transfer')
  ctx.startMovementEdit({ ...movement, originAccountId: null, destinationAccountId: 2 })
  assert.equal(ctx.movementOperation, 'income')
})

test('movement checkboxes select one mode and lock linked operations without mixing fields', () => {
  const ctx = financeState({ dashboard: {
    ...dashboard(),
    loans: [{ id: 12, name: 'Ana', type: 'me_deben', remaining: '50' },
      { id: 13, name: 'Banco', type: 'debo', remaining: '20' }],
  } })
  let markup = text(ctx.renderMovementForm())
  assert.match(markup, /value=normal \.checked=true/)
  assert.match(markup, /<select\s+name="operation"/)
  assert.doesNotMatch(markup, /<select name="planId"|<select name="subscriptionId"|<select name="loanId"/)
  ctx.selectMovementMode({ currentTarget: { value: 'investment', checked: true } })
  markup = text(ctx.renderMovementForm())
  assert.equal(ctx.movementOperation, 'expense')
  assert.match(markup, /value=investment \.checked=true/)
  assert.match(markup, /name="planId" required/)
  assert.doesNotMatch(markup, /<select\s+name="operation"|name="categoryId"|name="loanId"|name="subscriptionId"/)
  const checked = { value: 'investment', checked: false }
  ctx.selectMovementMode({ currentTarget: checked })
  assert.equal(checked.checked, true)
  assert.equal(ctx.movementMode, 'investment')
  ctx.selectMovementMode({ currentTarget: { value: 'subscription', checked: true } })
  markup = text(ctx.renderMovementForm())
  assert.match(markup, /name="subscriptionId" required/)
  assert.doesNotMatch(markup, /name="planId"|<select\s+name="operation"/)
  ctx.selectMovementMode({ currentTarget: { value: 'loan', checked: true } })
  ctx.selectMovementLoan({ currentTarget: { value: '12' } })
  markup = text(ctx.renderMovementForm())
  assert.equal(ctx.movementOperation, 'income')
  assert.match(markup, /Ingreso \(cobro de préstamo\)/)
  assert.match(markup, /name="destinationAccountId" required/)
  assert.doesNotMatch(markup, /name="originAccountId"|name="planId"|name="subscriptionId"/)
  ctx.selectMovementLoan({ currentTarget: { value: '13' } })
  assert.equal(ctx.movementOperation, 'expense')
  ctx.selectMovementMode({ currentTarget: { value: 'normal', checked: true } })
  assert.equal(ctx.movementLoanId, null)
  assert.match(text(ctx.renderMovementForm()), /<select\s+name="operation"/)
})

test('saving a linked movement sends only its selected relationship and fixed operation', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'FormData', function () {
    return new Map([['date', '2026-12-09'], ['amount', '10'], ['originAccountId', '2'],
      ['destinationAccountId', '3'], ['categoryId', '4'], ['planId', '8'], ['subscriptionId', '9']])
  })
  t.mock.method(globalThis, 'fetch', async (_path, options) => {
    requests.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ id: 20 }))
  })
  const ctx = financeState({ refreshDashboard: async () => {} })
  for (const [mode, loanId] of [['subscription', null], ['investment', null], ['loan', 13], ['loan', 14]]) {
    ctx.movementMode = mode
    ctx.movementOperation = 'transfer'
    ctx.movementLoanId = loanId
    if (mode === 'loan') ctx.dashboard.loans = [{ id: 13, type: 'debo' }, { id: 14, type: 'me_deben' }]
    await ctx.handleSaveMovement({ preventDefault() {}, currentTarget: {} })
    assert.equal(ctx.error, '')
  }
  assert.deepEqual(requests.map(({ operation, categoryId, planId, subscriptionId, loanId }) =>
    ({ operation, categoryId, planId, subscriptionId, loanId })), [
    { operation: 'expense', categoryId: null, planId: null, subscriptionId: '9', loanId: undefined },
    { operation: 'expense', categoryId: null, planId: '8', subscriptionId: null, loanId: undefined },
    { operation: 'expense', categoryId: null, planId: null, subscriptionId: null, loanId: 13 },
    { operation: 'income', categoryId: null, planId: null, subscriptionId: null, loanId: 14 },
  ])
  assert.equal(requests[2].destinationAccountId, null)
  assert.equal(requests[3].originAccountId, null)
})

for (const fails of [false, true]) {
  test(`movement save ${fails ? 'exposes errors without closing the modal' : 'closes the modal and refreshes dashboard/calendar data'}`, async (t) => {
    t.mock.method(globalThis, 'FormData', function () {
      return new Map([['date', '2026-12-09'], ['amount', '100.00'], ['originAccountId', '2'], ['planId', '8']])
    })
    t.mock.method(globalThis, 'fetch', async (path, options) => {
      assert.equal(path, '/api/movements')
      assert.equal(JSON.parse(options.body).date, '2026-12-09')
      assert.equal(JSON.parse(options.body).planId, '8')
      return new Response(JSON.stringify(fails ? { error: 'Saldo insuficiente' } : { id: 11 }), { status: fails ? 409 : 201 })
    })
    let refreshed = false
    const ctx = financeState({ showMovementForm: true, movementMode: 'investment',
      refreshDashboard: async () => { refreshed = true } })
    await ctx.handleSaveMovement({ preventDefault() {}, currentTarget: {} })
    assert.equal(ctx.showMovementForm, fails)
    assert.equal(ctx.submitting, false)
    assert.equal(refreshed, !fails)
    assert.equal(ctx.error, fails ? 'Saldo insuficiente' : '')
  })
}

test('category creation updates the shared catalog and selects the new category in matching operations', async (t) => {
  t.mock.method(globalThis, 'FormData', function () { return new Map([['name', 'Comida'], ['type', 'gasto']]) })
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, '/api/categories')
    assert.deepEqual(JSON.parse(options.body), { name: 'Comida', type: 'gasto' })
    return new Response(JSON.stringify({ category: { id: 22, name: 'Comida', type: 'gasto' } }))
  })
  const ctx = financeState()
  let reset = false
  await ctx.handleCreateCategory({ preventDefault() {}, currentTarget: { reset() { reset = true } } })
  assert.equal(ctx.dashboard.categories.length, 2)
  assert.equal(ctx.createdCategory.id, 22)
  assert.equal(reset, true)
  assert.match(text(ctx.renderMovementForm()), /name="categoryId" .value=22/)
  assert.match(text(ctx.renderCategoryForm()), /compartidas por la aplicación/)
  ctx.movementOperation = 'income'
  assert.doesNotMatch(text(ctx.renderMovementForm()), /name="categoryId" .value=22/)
})

test('category errors retain the form and surface the API error', async (t) => {
  t.mock.method(globalThis, 'FormData', function () { return new Map([['name', 'Comida'], ['type', 'gasto']]) })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Ya existe' }), { status: 409 }))
  const ctx = financeState()
  await ctx.handleCreateCategory({ preventDefault() {}, currentTarget: { reset() { assert.fail() } } })
  assert.equal(ctx.categoryError, 'Ya existe')
  assert.equal(ctx.dashboard.categories.length, 1)
  assert.equal(ctx.submitting, false)
})
