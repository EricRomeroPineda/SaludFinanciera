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
  periodUnit: 'mes', periodsRemaining: 3, visible: 1,
}
const state = (changes = {}) => ({
  ...Object.fromEntries(Object.getOwnPropertyNames(handlers)
    .filter((name) => typeof handlers[name] === 'function')
    .map((name) => [name, handlers[name]])),
  dashboard: { plans: [plan] }, today: new Date(2026, 10, 18, 12), ...changes,
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
  assert.match(markup, /class="plan-card"/)
  assert.doesNotMatch(markup, /<table/)
  assert.match(markup, /<progress max="100" .value=33\.333/)
  assert.match(markup, /Meta fija/)
  assert.match(markup, /Monetizado/)
  assert.match(markup, /Meses faltantes/)
  assert.match(markup, /Finalización estimada/)
})

test('weekly cards, overfunding and legacy plans have explicit states', () => {
  const ctx = state()
  assert.match(text(ctx.renderPlanCard({ ...plan, periodUnit: 'semana' })), /Semanas faltantes/)
  const completed = text(ctx.renderPlanCard({ ...plan, saved: '400.00', remaining: '-100.00' }))
  assert.match(completed, /Meta completada/)
  assert.match(completed, /<progress max="100" .value=100/)
  assert.doesNotMatch(completed, /Finalización estimada/)
  const legacy = text(ctx.renderPlanCard({ ...plan, periodsRemaining: null }))
  assert.match(legacy, /Edita el plan para configurar/)
  assert.doesNotMatch(legacy, /Invalid Date|NaN/)
})

test('plan forms capture manual periods using the existing schema, not accumulated amounts or new columns', () => {
  const markup = text(handlers.renderPlans.call(state({ showPlanForm: true, editingPlan: plan })))
  for (const name of ['name', 'goal', 'unitPeriod', 'periodsRemaining', 'visible']) {
    assert.ok(markup.includes(`name="${name}"`))
  }
  assert.doesNotMatch(markup, /name="(?:saved|monetized|monetizado|remaining|contribution|firstContributionDate)"/)
  assert.match(markup, /no es un vencimiento guardado ni detecta impagos/)
})

for (const editing of [false, true]) {
  test(`plan ${editing ? 'edit' : 'create'} sends the schedule and reloads the calculated data`, async (t) => {
    const form = new Map([
      ['name', 'Vacaciones'], ['goal', '300.00'], ['unitPeriod', 'mes'],
      ['periodsRemaining', '3'], ['visible', 'on'],
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
      name: 'Vacaciones', goal: '300.00', unitPeriod: 'mes', periodsRemaining: '3', visible: true,
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
