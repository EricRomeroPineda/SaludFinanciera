import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css?inline')) {
      return { format: 'module', source: 'export default ""', shortCircuit: true }
    }
    return next(url, context)
  },
})
const components = new Map()
globalThis.customElements = { define: (name, component) => components.set(name, component) }
await import('./salud-financiera.js')
const handlers = components.get('salud-financiera').prototype
const plan = {
  id: 8, name: 'Vacaciones', goal: '300.00', saved: '100.00', remaining: '200.00',
  periodUnit: 'mes', contribution: '100.00', contributionDay: 18, visible: 1,
}
const state = (changes = {}) => ({
  ...Object.fromEntries(Object.getOwnPropertyNames(handlers)
    .filter((name) => typeof handlers[name] === 'function')
    .map((name) => [name, handlers[name]])),
  dashboard: { plans: [plan] }, planUnit: 'mes', today: new Date(2026, 10, 18, 12), ...changes,
})

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) {
    return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  }

  return value == null || typeof value === 'function' ? '' : String(value)
}

test('cash is selectable, editable and visible with only an available balance', () => {
    const account = { id: 9, name: 'Cartera', type: 'Efectivo', available: '250.50' }
    const ctx = state({
      dashboard: { accounts: [account] }, formAvailable: '250.50', formLimit: '',
    })
    ctx.startAccountEdit(account)
    assert.equal(ctx.newAccountType, 'Efectivo')
    const form = text(ctx.renderAccountForm())
    assert.match(form, /value="Efectivo" .selected=true/)
    assert.match(form, /name="available"/)
    assert.doesNotMatch(form, /name="(?:total|statementDate|paymentDueDate|paymentToAvoidInterest)"/)
    assert.match(text(ctx.renderCards()), /Cartera/)
    const card = text(ctx.renderBankCard(account))
    assert.match(card, /Saldo disponible/)
    assert.doesNotMatch(card, /Fecha de corte|Fecha límite|Registrar pago|Saldo utilizado|Límite máximo/)
})

test('overview period controls switch monthly and annual payment totals without changing current balances', () => {
  const ctx = state({
    dashboard: {
      plans: [], subscriptions: [], movements: [], summary: {},
      accounts: [{ type: 'Crédito', name: 'Banco', available: '10', total: '100',
        paymentDueDate: '2026-12-01', paymentToAvoidInterest: '90' }],
    },
  })
  let markup = text(ctx.renderOverview())
  assert.match(markup, /Seleccionar mes/)
  assert.doesNotMatch(markup, /<select|type="month"/)
  assert.match(markup, /Pendiente del periodo 2026-11/)
  assert.match(markup, /Disponible con crédito/)
  assert.match(markup, /Deuda total/)
  ctx.overviewPeriod = '2026-12'
  markup = text(ctx.renderOverview())
  assert.match(markup, /Pendiente del periodo 2026-12/)
  ctx.overviewScope = 'year'
  markup = text(ctx.renderOverview())
  assert.match(markup, /Calendario de años/)
  assert.match(markup, /Pendiente del periodo 2026</)
})

test('overview shows complete period activity, remaining card sums, warnings and manual controls', () => {
  const ctx = state({
    today: new Date(2027, 0, 11),
    dashboard: {
      plans: [], subscriptions: [], movements: [], summary: {},
      activityByMonth: [{ month: '2027-01', income: '10000.10', expenses: '3000.20' }],
      accounts: [{ id: 1, type: 'Crédito', name: 'Banco', available: '10', total: '100',
        paymentDueDate: '2027-01-10', paymentToAvoidInterest: '90', paymentTransfers: '20' }],
    },
  })
  let markup = text(ctx.renderOverview())
  assert.match(markup, /Ingresos del periodo/)
  assert.match(markup, /10,000\.10/)
  assert.match(markup, /Gastos del periodo/)
  assert.match(markup, /3,000\.20/)
  assert.match(markup, /Pago para no generar intereses[\s\S]*?\$70\.00/)
  assert.match(markup, /⚠ Pago vencido/)
  assert.match(markup, /revisa el nuevo pago para no generar intereses/)
  assert.match(markup, /Confirmar pago manualmente/)
  assert.match(markup, /Revisar importe/)
  assert.match(markup, /class="data-card overview-period"/)
  ctx.dashboard.accounts[0].confirmedPaymentDueDate = '2027-01-10'
  ctx.dashboard.accounts[0].confirmedPaymentAmount = '90'
  const cardMarkup = text(ctx.renderBankCard(ctx.dashboard.accounts[0]))
  assert.match(cardMarkup, /Pago confirmado manualmente/)
  assert.doesNotMatch(cardMarkup, /⚠ Pago vencido/)
  assert.match(cardMarkup, /Retirar confirmación manual/)
  ctx.dashboard.accounts[0].confirmedPaymentDueDate = null
  ctx.dashboard.accounts[0].paymentTransfers = '90'
  assert.match(text(ctx.renderBankCard(ctx.dashboard.accounts[0])), /Pago cubierto con los abonos registrados/)
})

test('manual card confirmation sends the shown cycle, refreshes the dashboard and reports refresh failures explicitly', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })
  const previousWindow = globalThis.window
  globalThis.window = { confirm: () => true }
  t.after(() => { globalThis.window = previousWindow })
  let refreshed = 0
  const ctx = state({ refreshDashboard: async () => { refreshed++ } })
  const card = { id: 5, paymentDueDate: '2027-01-10', paymentToAvoidInterest: '100' }
  await ctx.handleConfirmCardPayment(card)
  assert.equal(requests[0].url, '/api/accounts/5/payment-confirmation')
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    confirmed: true, paymentDueDate: '2027-01-10', paymentToAvoidInterest: '100',
  })
  assert.equal(refreshed, 1)
  assert.equal(ctx.submitting, false)
  await ctx.handleConfirmCardPayment({ ...card, confirmedPaymentDueDate: card.paymentDueDate, confirmedPaymentAmount: '100' })
  assert.equal(JSON.parse(requests[1].options.body).confirmed, false)
  ctx.refreshDashboard = async () => { throw new Error('Sin conexión') }
  await ctx.handleConfirmCardPayment(card)
  assert.match(ctx.error, /La confirmación se guardó, pero no se pudo actualizar el panorama: Sin conexión/)
  ctx.familyView = true
  await ctx.handleConfirmCardPayment(card)
  assert.equal(requests.length, 3)
})

test('plan viewer renders cards, calculated progress and monthly dates rather than a table', () => {
  const markup = text(handlers.renderPlans.call(state()))
  assert.match(markup, /class="plan-card /)
  assert.doesNotMatch(markup, /<table/)
  assert.match(markup, /<progress max="100" .value=33\.333/)
  assert.match(markup, /Meta fija/)
  assert.match(markup, /Monetizado/)
  assert.match(markup, /Meses faltantes/)
  assert.match(markup, /Finalización estimada/)
})

test('weekly cards, overfunding and legacy plans have explicit states', () => {
  const ctx = state()
  assert.match(text(ctx.renderPlanCard({ ...plan, periodUnit: 'semana', contributionDay: 3 })), /Semanas faltantes/)
  const completed = text(ctx.renderPlanCard({ ...plan, saved: '400.00', remaining: '-100.00' }))
  assert.match(completed, /Meta completada/)
  assert.match(completed, /<progress max="100" .value=100/)
  assert.doesNotMatch(completed, /Finalización estimada/)
  const legacy = text(ctx.renderPlanCard({ ...plan, contribution: null }))
  assert.match(legacy, /Edita el plan para configurar/)
  assert.doesNotMatch(legacy, /Invalid Date|NaN/)
})

test('plan forms capture contribution and scheduled day, never manual savings or periods', () => {
  const markup = text(handlers.renderPlans.call(state({ showPlanForm: true, editingPlan: plan })))
  for (const name of ['name', 'goal', 'unitPeriod', 'contribution', 'contributionDay', 'startDate', 'visible']) {
    assert.ok(markup.includes(`name="${name}"`))
  }
  assert.doesNotMatch(markup, /name="(?:saved|monetized|monetizado|remaining|periodsRemaining|firstContributionDate)"/)
  assert.match(markup, /type="number" min="1" max="31"/)
  const weekly = text(handlers.renderPlans.call(state({ showPlanForm: true, planUnit: 'semana' })))
  assert.match(weekly, /Lunes/)
  assert.match(weekly, /Domingo/)
  assert.match(weekly, /<select name="contributionDay"/)
})

test('editing either module exposes the start date first, including existing records without a date', () => {
  const subscriptions = components.get('finance-subscriptions').prototype
  for (const startDate of [null, '2026-11-18']) {
    const planMarkup = text(handlers.renderPlans.call(state({
      showPlanForm: true, editingPlan: { ...plan, startDate },
    })))
    const subscriptionMarkup = text(subscriptions.renderForm.call({
      editing: { id: 8, name: 'Internet', frequency: 'Mensual', startDate },
      formCost: '100', formFrequency: 'Mensual',
    }))
    for (const markup of [planMarkup, subscriptionMarkup]) {
      assert.ok(markup.indexOf('name="startDate"') < markup.indexOf('name="name"'))
      assert.match(markup, /Editar/)
      assert.match(markup, /name="startDate" type="date"[^>]*required/)
      if (startDate) assert.ok(markup.includes(`.value=${startDate}`))
    }
  }
})

test('opening edit brings the start date into view in both modules', () => {
  const subscriptions = components.get('finance-subscriptions').prototype
  for (const [prototype, changed, flags] of [
    [handlers, 'editingPlan', { showPlanForm: true }],
    [subscriptions, 'editing', { showForm: true }],
  ]) {
    let scrolled = false
    let focused = false
    const form = {
      scrollIntoView() { scrolled = true },
      querySelector(selector) {
        assert.equal(selector, '[name="startDate"]')
        return { focus() { focused = true } }
      },
    }
    prototype.updated.call({
      ...flags, started: true, renderRoot: { querySelector: () => form },
    }, new Map([[changed, null]]))
    assert.equal(scrolled, true)
    assert.equal(focused, true)
  }
})

for (const editing of [false, true]) {
  test(`plan ${editing ? 'edit' : 'create'} sends the schedule and reloads the calculated data`, async (t) => {
    const form = new Map([
      ['name', 'Vacaciones'], ['goal', '300.00'], ['unitPeriod', 'mes'],
      ['contribution', '100.00'], ['contributionDay', '18'], ['startDate', '2026-11-18'], ['visible', 'on'],
    ])
    t.mock.method(globalThis, 'FormData', function () { return form })
    let request
    t.mock.method(globalThis, 'fetch', async (path, options) => {
      request = { path, options }
      return new Response(JSON.stringify({ id: 8 }))
    })
    let refreshed = false
    const ctx = state({
      editingPlan: editing ? plan : null, showPlanForm: true,
      refreshDashboard: async () => { refreshed = true },
    })
    await ctx.handleCreatePlan({ preventDefault() {}, currentTarget: {} })
    assert.equal(request.path, editing ? '/api/plans/8' : '/api/plans')
    assert.equal(request.options.method, editing ? 'PUT' : 'POST')
    assert.deepEqual(JSON.parse(request.options.body), {
      name: 'Vacaciones', goal: '300.00', unitPeriod: 'mes', contribution: '100.00', contributionDay: '18', startDate: '2026-11-18', visible: true,
    })
    assert.equal(ctx.error, '')
    assert.equal(ctx.showPlanForm, false)
    assert.equal(ctx.submitting, false)
    assert.equal(refreshed, true)
  })
}

test('panorama respects visibility while the plans viewer retains hidden plans', () => {
  const hidden = { ...plan, id: 9, name: 'Plan oculto', visible: 0 }
  const ctx = state({
    dashboard: {
      plans: [plan, hidden], subscriptions: [], movements: [], accounts: [],
      summary: { plansCount: 2, accountsCount: 0, activeSubscriptionsCount: 0, movementsCount: 0 },
    },
  })
  const overview = text(ctx.renderOverview())
  assert.match(overview, /Vacaciones/)
  assert.doesNotMatch(overview, /Plan oculto/)
  assert.match(text(ctx.renderPlans()), /Plan oculto/)
})

test('panorama limits the summary to four visible plans and reserves details and actions for the plans screen', () => {
  const ctx = state({
    selectedPlan: plan,
    dashboard: {
      plans: Array.from({ length: 6 }, (_, index) => ({ ...plan, id: index + 1, name: `Meta ${index + 1}` })),
      subscriptions: [], movements: [], accounts: [], summary: {},
    },
  })
  const overview = ctx.renderOverview()
  const markup = text(overview)
  assert.match(markup, /Meta 1/)
  assert.match(markup, /Meta 4/)
  assert.doesNotMatch(markup, /Meta 5|Meta 6/)
  assert.equal((markup.match(/<progress /g) || []).length, 4)
  assert.match(markup, /Mostrando 4 planes/)
  assert.doesNotMatch(markup, /plan-card|Registrar movimiento|Editar plan|card-trash-button|finance-related-movements|Finalización estimada|Próxima aportación/)
  const plans = text(ctx.renderPlans())
  assert.match(plans, /Meta 6/)
  assert.match(plans, /Registrar movimiento/)
  ctx.selectedPlan = ctx.dashboard.plans[0]
  assert.match(text(ctx.renderPlanMovements(ctx.dashboard.plans).values[1]), /finance-related-movements/)
})

test('plan countdown distinguishes today, tomorrow and later and omits completed plans', () => {
  const ctx = state()
  for (const [date, expected] of [
    ['2026-11-18', '¡Hoy es día de aportar!'],
    ['2026-11-19', 'Falta 1 día para aportar'],
    ['2026-11-20', 'Faltan 2 días para aportar'],
    ['2026-11-23', 'Faltan 5 días para aportar'],
  ]) {
    const markup = text(ctx.renderPlanCountdown({ completed: false, nextContributionDate: date }))
    assert.ok(markup.includes(expected))
    assert.equal(markup.includes('urgent'), date <= '2026-11-20')
  }
  assert.equal(ctx.renderPlanCountdown({ completed: true, nextContributionDate: null }), '')
  assert.equal(ctx.renderPlanCountdown({ completed: false, nextContributionDate: null }), '')
})

test('registering a plan movement opens a fresh expense with that plan preselected', () => {
  const ctx = state({
    editingMovement: { id: 12, planId: 99 }, movementOperation: 'transfer',
    newMovementDefaults: { cardName: 'Old card' },
  })
  ctx.startPlanMovement(plan)
  assert.equal(ctx.activeTab, 'movements')
  assert.equal(ctx.showMovementForm, true)
  assert.equal(ctx.editingMovement, null)
  assert.equal(ctx.movementOperation, 'expense')
  assert.deepEqual(ctx.newMovementDefaults, { planId: 8, planName: 'Vacaciones' })
  ctx.dashboard = { ...ctx.dashboard, accounts: [], categories: [], subscriptions: [] }
  const markup = text(ctx.renderMovementForm())
  assert.match(markup, /<select name="planId" .value=8>/)
  assert.match(markup, /Registra una aportación para Vacaciones/)
})

test('plan cards select only on surface click or Enter/Space, with separate trash and movement actions', () => {
  const ctx = state()
  const card = ctx.renderPlanCard(plan)
  const callbacks = card.values.filter((value) => typeof value === 'function')
  const [click, keydown] = callbacks
  click({ target: { closest: () => ({}) } })
  assert.equal(ctx.selectedPlan, undefined)
  click({ target: { closest: () => null } })
  assert.equal(ctx.selectedPlan, plan)
  for (const key of ['Enter', ' ']) {
    ctx.selectedPlan = null
    const target = {}
    let prevented = false
    keydown({ key, target, currentTarget: target, preventDefault() { prevented = true } })
    assert.equal(ctx.selectedPlan, plan)
    assert.equal(prevented, true)
  }
  ctx.selectedPlan = null
  keydown({ key: 'Enter', target: {}, currentTarget: {}, preventDefault() { assert.fail() } })
  assert.equal(ctx.selectedPlan, null)
  const markup = text(card)
  assert.match(markup, /Registrar movimiento/)
  assert.match(markup, /class="card-trash-button"/)
  assert.match(markup, /aria-label=Eliminar Vacaciones/)
})

test('plan history renders only for a currently selected plan and is keyed by refreshed dashboard', () => {
  const ctx = state()
  assert.equal(ctx.renderPlanMovements([plan]), '')
  ctx.selectedPlan = plan
  const detail = ctx.renderPlanMovements([plan])
  assert.equal(detail.values[0], ctx.dashboard)
  assert.match(text(detail.values[1]), /relation="plan"/)
  assert.match(text(detail.values[1]), /\.relationId=8/)
  assert.equal(ctx.renderPlanMovements([]), '')
})

test('trash opens a confirmation modal, cancel does not issue deletion', async () => {
  let opened = false
  let closed = false
  const dialog = { showModal() { opened = true }, close() { closed = true } }
  const ctx = state({ renderRoot: { querySelector: () => dialog }, updateComplete: Promise.resolve() })
  await ctx.requestDeletePlan(plan)
  assert.equal(opened, true)
  assert.equal(ctx.pendingDeletePlan, plan)
  ctx.closePlanDeleteDialog()
  assert.equal(closed, true)
  assert.equal(ctx.pendingDeletePlan, null)
})

for (const fails of [false, true]) {
  test(`plan deletion ${fails ? 'preserves modal and exposes linked-movement error' : 'clears selection and refreshes after confirmation'}`, async (t) => {
    let closed = false
    let refreshed = false
    t.mock.method(globalThis, 'fetch', async (path, options) => {
      assert.equal(path, '/api/plans/8')
      assert.equal(options.method, 'DELETE')
      return new Response(JSON.stringify(fails ? { error: 'Tiene movimientos relacionados.' } : { ok: true }),
        { status: fails ? 409 : 200 })
    })
    const ctx = state({
      pendingDeletePlan: plan, selectedPlan: plan, editingPlan: plan, showPlanForm: true,
      renderRoot: { querySelector: () => ({ close() { closed = true } }) },
      refreshDashboard: async () => { refreshed = true },
    })
    await ctx.handleDeletePlan()
    assert.equal(closed, !fails)
    assert.equal(refreshed, !fails)
    assert.equal(ctx.pendingDeletePlan, fails ? plan : null)
    assert.equal(ctx.selectedPlan, fails ? plan : null)
    assert.equal(ctx.submitting, false)
    if (fails) assert.equal(ctx.error, 'Tiene movimientos relacionados.')
    else assert.equal(ctx.showPlanForm, false)
  })
}
