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
const loans = components.get('finance-loans').prototype
const subscriptions = components.get('finance-subscriptions').prototype
const google = components.get('google-calendar-sync').prototype
const deposit = 'Banco prueba, cuenta 001234567890'
const methods = (prototype) => Object.fromEntries(Object.getOwnPropertyNames(prototype)
  .filter((name) => typeof prototype[name] === 'function').map((name) => [name, prototype[name]]))

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  if (value?.values) return text(value.values)
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('all four forms show an optional text deposit field and restore saved text while Me deben omits it', () => {
  const financial = {
    ...methods(finance), dashboard: { accounts: [], plans: [] }, showPlanForm: true, planUnit: 'mes',
    editingAccount: { depositDetails: deposit }, editingPlan: { depositDetails: deposit },
  }
  const markup = [
    financial.renderAccountForm(), financial.renderPlans(),
    subscriptions.renderForm.call({ editing: { depositDetails: deposit }, formFrequency: 'Mensual' }),
    loans.renderForm.call({ editing: { type: 'debo', depositDetails: deposit }, accounts: [] }),
  ]
  for (const form of markup.map(text)) {
    assert.match(form, /name="depositDetails" maxlength="500"/)
    assert.ok(form.includes(`.value=${deposit}`))
    assert.doesNotMatch(form, /name="depositDetails"[^>]*required/)
  }
  const receiving = text(loans.renderForm.call({ editing: { type: 'me_deben', depositDetails: deposit }, accounts: [] }))
  assert.doesNotMatch(receiving, /name="depositDetails"/)
})

test('create and edit handlers send deposit text to each owner-scoped resource without converting it into a number', async (t) => {
  t.mock.method(globalThis, 'FormData', function () {
    return new Map([['depositDetails', deposit], ['name', 'Prueba'], ['type', 'debo']])
  })
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, options })
    return new Response(JSON.stringify({ id: 8, subscription: { id: 8, name: 'Servicio', depositDetails: deposit } }))
  })
  for (const editing of [false, true]) {
    const state = {
      editingAccount: editing ? { id: 8 } : null,
      editingPlan: editing ? { id: 8 } : null,
      editing: editing ? { id: 8 } : null, loanType: 'debo',
      refreshDashboard: async () => {}, dispatchEvent() {}, notifyChange() {}, items: [],
    }
    const event = { preventDefault() {}, currentTarget: {} }
    await finance.handleCreateAccount.call(state, event)
    await finance.handleCreatePlan.call(state, event)
    await subscriptions.save.call(state, event)
    state.editing = editing ? { id: 8 } : null
    await loans.save.call(state, event)
    for (const call of calls.slice(-4)) {
      assert.equal(call.options.method, editing ? 'PUT' : 'POST')
      assert.equal(JSON.parse(call.options.body).depositDetails, deposit)
    }
  }
})

test('Google preview explicitly discloses deposit sharing and both days of fixed notification times', () => {
  const markup = text(google.render.call({
    config: { configured: true }, month: '2026-11', selected: new Set(), results: {},
    events: [
      { key: 'one', kind: 'loan', loanType: 'debo', label: 'Pagar', date: '2026-11-25', depositDetails: deposit },
      { key: 'two', kind: 'loan', loanType: 'me_deben', label: 'Cobrar', date: '2026-11-25', depositDetails: 'DO NOT SHARE' },
    ],
  }))
  assert.ok(markup.includes(deposit))
  assert.doesNotMatch(markup, /DO NOT SHARE|type="time"/)
  assert.match(markup, /09:00, 14:00 y 21:00/)
  assert.match(markup, /dos eventos privados/)
  assert.match(markup, /seis avisos en total/)
  assert.match(markup, /datos de depósito si existen/)
})
