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
const loans = components.get('finance-loans').prototype
const finance = components.get('salud-financiera').prototype
const calendar = components.get('financial-calendar').prototype
const related = components.get('finance-related-movements').prototype
const item = {
  id: 8, name: 'Ana', type: 'me_deben', principal: '100', paid: '40', remaining: '60',
  startDate: '2026-11-19', commitmentDate: '2026-12-19', accountId: 2, accountName: 'Cartera',
  legacy: 0, notes: 'Pendiente personal',
}
const accounts = [{ id: 2, name: 'Cartera', available: '900' }]
const methods = (prototype) => Object.fromEntries(Object.getOwnPropertyNames(prototype)
  .filter((name) => typeof prototype[name] === 'function').map((name) => [name, prototype[name]]))

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  if (value?.values) return text(value.values)
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('loan cards show direction, principal, repaid, pending, commitment and the same complete history component', () => {
  const state = { ...methods(loans), items: [item], accounts, selectedId: item.id }
  const markup = text(state.render())
  for (const label of ['Me deben', 'Por cobrar', 'Monto registrado', 'Abonado', 'Fecha compromiso', 'Cartera', 'Pendiente personal']) {
    assert.ok(markup.includes(label), label)
  }
  assert.match(markup, /<finance-related-movements relation="loan"/)
  const owed = text(state.render.call({ ...state, items: [{ ...item, type: 'debo', remaining: '0' }] }))
  assert.match(owed, /Yo debo/)
  assert.match(owed, /Por pagar/)
  assert.match(owed, /Liquidado/)
})

test('new and historical loan forms explicitly distinguish moving money from opening a prior balance', () => {
  const state = { ...methods(loans), accounts, mode: 'new', loanType: 'me_deben' }
  assert.match(text(state.renderForm()), /Nuevo · Mover dinero ahora/)
  assert.match(text(state.renderForm()), /Tarjeta \/ efectivo de donde sale/)
  const legacy = text(state.renderForm.call({ ...state, mode: 'legacy' }))
  assert.match(legacy, /Monto pendiente al comenzar/)
  assert.match(legacy, /No se creará un desembolso/)
  const owed = text(state.renderForm.call({ ...state, loanType: 'debo' }))
  assert.match(owed, /donde recibes el préstamo/)
})

for (const recordDisbursement of [true, false]) {
  test(`loan form persists its ${recordDisbursement ? 'new' : 'historical'} mode and reports success only after the API`, async (t) => {
    const data = new Map(Object.entries({
      name: item.name, commitmentDate: item.commitmentDate, accountId: '2', notes: '',
      principal: '100', startDate: item.startDate,
    }))
    t.mock.method(globalThis, 'FormData', function () { return data })
    let request
    t.mock.method(globalThis, 'fetch', async (path, options) => {
      request = { path, options }
      return new Response(JSON.stringify({ id: 8, movementId: recordDisbursement ? 9 : null }))
    })
    let changed = false
    const state = { mode: recordDisbursement ? 'new' : 'legacy', loanType: 'me_deben', dispatchEvent() { changed = true } }
    await loans.save.call(state, { preventDefault() {}, currentTarget: {} })
    assert.equal(request.path, '/api/loans')
    assert.equal(JSON.parse(request.options.body).recordDisbursement, recordDisbursement)
    assert.equal(state.showForm, false)
    assert.equal(changed, true)
    assert.equal(state.busy, false)
  })
}

test('loan save errors keep the form open and do not claim a data refresh', async (t) => {
  t.mock.method(globalThis, 'FormData', function () { return new Map() })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Saldo insuficiente' }), { status: 409 }))
  const state = { mode: 'new', loanType: 'me_deben', showForm: true, dispatchEvent() { assert.fail('Failed save') } }
  await loans.save.call(state, { preventDefault() {}, currentTarget: {} })
  assert.equal(state.error, 'Saldo insuficiente')
  assert.equal(state.showForm, true)
})

for (const type of ['me_deben', 'debo']) {
  test(`repayment for ${type} prefills the correct account direction and submits the linked movement`, async (t) => {
    const state = {
      ...methods(finance), dashboard: { accounts, loans: [{ ...item, type }], categories: [], subscriptions: [], plans: [] },
      formatMoney: (value) => `$${value}`,
    }
    state.startLoanPayment({ ...item, type })
    assert.equal(state.showMovementForm, true)
    assert.equal(state.movementLoanId, item.id)
    assert.equal(state.movementOperation, type === 'me_deben' ? 'income' : 'expense')
    assert.equal(state.newMovementDefaults.amount, '60')
    const markup = text(state.renderMovementForm())
    assert.match(markup, /Abono a Ana/)
    assert.ok(markup.includes(type === 'me_deben' ? 'Cuenta de destino' : 'Cuenta de origen'))
    assert.doesNotMatch(markup, /name="categoryId"|name="planId"|name="subscriptionId"/)
    t.mock.method(globalThis, 'FormData', function () { return new Map([
      ['amount', '20'], ['date', '2026-11-20'],
      [type === 'me_deben' ? 'destinationAccountId' : 'originAccountId', '2'],
    ]) })
    let payload
    t.mock.method(globalThis, 'fetch', async (path, options) => {
      assert.equal(path, '/api/movements')
      payload = JSON.parse(options.body)
      return new Response(JSON.stringify({ ok: true, id: 9 }))
    })
    state.refreshDashboard = async () => {}
    await state.handleSaveMovement({ preventDefault() {}, currentTarget: {} })
    assert.equal(payload.loanId, item.id)
    assert.equal(payload.loanKind, 'abono')
    assert.equal(payload.categoryId, null)
    assert.equal(state.showMovementForm, false)
  })
}

test('initial loan movements are labelled and immutable in the register, while history exposes movement IDs', () => {
  const movement = { id: 9, loanId: 8, loanKind: 'desembolso', loanName: 'Ana', originAccountId: 2, originAccount: 'Cartera', amount: '100', date: '2026-11-19' }
  const markup = text(calendar.renderMonthlyTable.call({
    data: { movements: [movement] }, formatMoney: (value) => `$${value}`, scope: 'all',
  }, 'Noviembre'))
  assert.match(markup, /Préstamo inicial · Ana/)
  assert.match(markup, /Desembolso fijo/)
  assert.match(markup, /Préstamo · Ana/)
  assert.doesNotMatch(markup, />Editar<|>Eliminar</)
  const history = text(related.render.call({ items: [movement], label: 'Ana' }))
  assert.match(history, /ID movimiento/)
  assert.match(history, /<td>9<\/td>/)
})

test('scheduled commitment opens a repayment on the selected day with the correct direction', () => {
  for (const type of ['me_deben', 'debo']) {
    const state = {
      ...methods(finance), dashboard: { loans: [{ ...item, type }] },
    }
    state.openCalendarMovement({ date: item.commitmentDate, event: { kind: 'loan', loanId: item.id } })
    assert.equal(state.movementLoanId, item.id)
    assert.equal(state.movementOperation, type === 'me_deben' ? 'income' : 'expense')
    assert.equal(state.newMovementDefaults.date, item.commitmentDate)
    assert.equal(state.newMovementDefaults.amount, item.remaining)
    assert.equal(state.showMovementForm, true)
  }
  const missing = { ...methods(finance), dashboard: { loans: [] } }
  missing.openCalendarMovement({ date: item.commitmentDate, event: { kind: 'loan', loanId: item.id } })
  assert.match(missing.error, /ya no está disponible/)
  assert.notEqual(missing.showMovementForm, true)
})

test('family loans are read only and keep the family scope when viewing related movements', () => {
  const markup = text(loans.render.call({ ...methods(loans), familyView: true, items: [item], selectedId: 8, accounts }))
  assert.match(markup, /class="card-actions" \?hidden=true/)
  assert.match(markup, /.familyView=true/)
})
