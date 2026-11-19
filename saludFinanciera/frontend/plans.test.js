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
  for (const name of ['name', 'goal', 'unitPeriod', 'contribution', 'contributionDay', 'visible']) {
    assert.ok(markup.includes(`name="${name}"`))
  }
  assert.doesNotMatch(markup, /name="(?:saved|monetized|monetizado|remaining|periodsRemaining|firstContributionDate)"/)
  assert.match(markup, /type="number" min="1" max="31"/)
  const weekly = text(handlers.renderPlans.call(state({ showPlanForm: true, planUnit: 'semana' })))
  assert.match(weekly, /Lunes/)
  assert.match(weekly, /Domingo/)
  assert.match(weekly, /<select name="contributionDay"/)
})

for (const editing of [false, true]) {
  test(`plan ${editing ? 'edit' : 'create'} sends the schedule and reloads the calculated data`, async (t) => {
    const form = new Map([
      ['name', 'Vacaciones'], ['goal', '300.00'], ['unitPeriod', 'mes'],
      ['contribution', '100.00'], ['contributionDay', '18'], ['visible', 'on'],
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
      name: 'Vacaciones', goal: '300.00', unitPeriod: 'mes', contribution: '100.00', contributionDay: '18', visible: true,
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
