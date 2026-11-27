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
const copy = components.get('copy-deposit').prototype
const deposit = 'Banco prueba, cuenta 001234567890'
const methods = (prototype) => Object.fromEntries(Object.getOwnPropertyNames(prototype)
  .filter((name) => typeof prototype[name] === 'function').map((name) => [name, prototype[name]]))

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  if (value?.values) return text(value.values)
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('debit and credit deposits use the same information card and preserve the full copy value', () => {
  const state = { ...methods(finance), today: new Date(2026, 10, 26) }
  const account = { id: 1, name: 'Cuenta', type: 'Tarjeta de débito', available: '100', depositDetails: deposit }
  const debit = text(state.renderBankCard(account))
  assert.match(debit, /class="card-payment card-deposit deposit-details"/)
  assert.ok(debit.includes(`<dl><dt>Depósito</dt><dd>${deposit}</dd></dl>`))
  assert.ok(debit.includes(`<copy-deposit .value=${deposit}></copy-deposit>`))
  assert.doesNotMatch(debit, /Depósito:/)
  const credit = text(state.renderBankCard({ ...account, type: 'Tarjeta de crédito' }))
  assert.match(credit, /class="card-payment card-deposit deposit-details"/)
  assert.ok(credit.includes(`<copy-deposit .value=${deposit}></copy-deposit>`))
  assert.doesNotMatch(text(state.renderBankCard({ ...account, depositDetails: '' })), /card-deposit|copy-deposit/)
})

test('plans, subscriptions and payable loans share the deposit card in card and list views', () => {
  const today = new Date(2026, 10, 26)
  const base = { id: 1, name: 'Prueba', depositDetails: deposit, startDate: '2026-01-01' }
  for (const listView of [false, true]) {
    const markup = [
      finance.renderPlans.call({
        ...methods(finance), today, plansListView: listView,
        dashboard: { plans: [{ ...base, goal: '100', saved: '0', remaining: '100', periodUnit: 'mes',
          contribution: '10', contributionDay: 28, visible: 1 }] },
      }),
      subscriptions.render.call({
        ...methods(subscriptions), today, listView,
        items: [{ ...base, status: 'activa', frequency: 'Mensual', cost: '100', billingDay: 28 }],
      }),
      loans.render.call({
        ...methods(loans), listView, accounts: [],
        items: [{ ...base, type: 'debo', principal: '100', paid: '0', remaining: '100', commitmentDate: '2026-11-28' }],
      }),
    ]
    for (const card of markup.map(text)) {
      assert.match(card, /class="card-payment card-deposit deposit-details"/)
      assert.ok(card.includes(`<dl><dt>Depósito</dt><dd>${deposit}</dd></dl>`))
      assert.ok(card.includes(`<copy-deposit .value=${deposit}></copy-deposit>`))
    }
  }
})

test('all four forms show an optional text deposit field and restore saved text while Me deben omits it', () => {
  const financial = {
    ...methods(finance), dashboard: { accounts: [], plans: [] }, showPlanForm: true, planUnit: 'mes',
    editingAccount: { depositDetails: deposit }, newAccountType: 'Tarjeta de débito',
    editingPlan: { depositDetails: deposit },
  }
  const markup = [
    financial.renderAccountForm(), financial.renderPlans(),
    subscriptions.renderForm.call({ editing: { depositDetails: deposit }, formFrequency: 'Mensual' }),
    loans.renderForm.call({ editing: { type: 'debo', depositDetails: deposit }, accounts: [] }),
  ]
  for (const form of markup.map(text)) {
    assert.match(form, /class="card-deposit"/)
    assert.match(form, /name="depositDetails" maxlength="500"/)
    assert.ok(form.includes(`.value=${deposit}`))
    assert.match(form, /<copy-deposit field>/)
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
  assert.match(markup, /tres eventos privados/)
  assert.match(markup, /seis avisos en total/)
  assert.match(markup, /datos de depósito si existen/)
  assert.match(markup, /<copy-deposit .value=Banco prueba/)
  assert.match(markup, /class="card-payment card-deposit deposit-details"/)
})

function clipboard(t, writeText) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText } } })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete globalThis.navigator
  })
}

test('copy preserves all deposit text including leading zeroes', async (t) => {
  let written
  clipboard(t, async (value) => { written = value })
  const state = { value: deposit }
  await copy.copy.call(state)
  assert.equal(written, deposit)
  assert.equal(state.notice, 'Datos copiados.')
  assert.equal(state.error, '')
  assert.equal(state.busy, false)
})

test('form copy reads the current edited input instead of the saved text', async (t) => {
  let written
  clipboard(t, async (value) => { written = value })
  const state = { field: true, value: 'old', closest: () => ({ querySelector: () => ({ value: 'CLABE 00001234' }) }) }
  await copy.copy.call(state)
  assert.equal(written, 'CLABE 00001234')
})

test('missing data and denied clipboard access report errors, never success', async (t) => {
  const state = { value: '' }
  await copy.copy.call(state)
  assert.match(state.error, /No hay datos/)
  clipboard(t, async () => { throw new Error('Denied') })
  state.value = deposit
  await copy.copy.call(state)
  assert.match(state.error, /No se pudo copiar/)
  assert.equal(state.notice, '')
  assert.equal(state.busy, false)
})
