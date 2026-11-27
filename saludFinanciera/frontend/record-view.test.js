import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { sortByDue, viewToggle } from './record-view.js'

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css?inline')) return { format: 'module', source: 'export default ""', shortCircuit: true }
    return next(url, context)
  },
})
const components = new Map()
globalThis.customElements = { define: (name, component) => components.set(name, component) }
await import('./salud-financiera.js')
const methods = (name) => {
  const prototype = components.get(name).prototype
  return Object.fromEntries(Object.getOwnPropertyNames(prototype)
    .filter((key) => typeof prototype[key] === 'function').map((key) => [key, prototype[key]]))
}
const today = new Date(2026, 10, 26, 12)

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  if (value?.values) return text(value.values)
  return value == null || typeof value === 'function' ? '' : String(value)
}

function toggle(template) {
  if (Array.isArray(template)) {
    for (const value of template) if (toggle(value)) return true
  }
  if (!template?.strings) return false
  if (template.strings.join('').includes('view-toggle')) {
    template.values.find((value) => typeof value === 'function')()
    return true
  }
  return toggle(template.values)
}

const names = (markup) => [...markup.matchAll(/<article\b[\s\S]*?<h3>(.*?)<\/h3>/g)].map((match) => match[1])

test('due sorting is nonmutating, overdue first, no date last and names break ties', () => {
  const items = [
    { id: 1, name: 'Sin fecha', days: null }, { id: 2, name: 'Luego', days: 2 },
    { id: 3, name: 'Zeta', days: 0 }, { id: 4, name: 'Alfa', days: 0 },
    { id: 5, name: 'Vencido', days: -2 }, { id: 6, name: 'Inválido', days: NaN },
  ]
  const original = [...items]
  assert.deepEqual(sortByDue(items, (item) => item.days).map((item) => item.id), [5, 4, 3, 2, 6, 1])
  assert.deepEqual(items, original)
  let listView = false
  assert.match(text(viewToggle(listView, () => { listView = true })), /Ver lista/)
  assert.equal(toggle(viewToggle(listView, () => { listView = true })), true)
  assert.equal(listView, true)
  assert.match(text(viewToggle(listView, () => {})), /Ver tarjetas/)
})

test('view toggle is icon-only with an accessible label and hover description for each target view', () => {
  for (const listView of [false, true]) {
    const markup = text(viewToggle(listView, () => {}))
    const label = listView ? 'Ver tarjetas' : 'Ver lista'
    assert.ok(markup.includes(`aria-label=${label} title=${label}`))
    assert.match(markup, /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/)
    assert.doesNotMatch(markup.replace(/<[^>]*>/g, '').trim(), /\S/)
    assert.match(markup, listView ? /<rect/ : /<path/)
  }
})

test('new card asks for type first, then name, account number and existing type-specific rules', () => {
  const ctx = { ...methods('salud-financiera'), formatMoney: (value) => `$${value}` }
  ctx.startCardCreation()
  assert.equal(ctx.newAccountType, '')
  assert.equal(ctx.showAccountForm, true)
  const initial = text(ctx.renderAccountForm())
  assert.match(initial, /<select name="type" required/)
  assert.doesNotMatch(initial, /name="name"|name="depositDetails"|name="available"|name="total"|name="statementDate"|Guardar cuenta/)
  ctx.newAccountType = 'Tarjeta de débito'
  const debit = text(ctx.renderAccountForm())
  assert.ok(debit.indexOf('name="type"') < debit.indexOf('name="name"'))
  assert.ok(debit.indexOf('name="name"') < debit.indexOf('name="depositDetails"'))
  assert.ok(debit.indexOf('name="depositDetails"') < debit.indexOf('name="available"'))
  assert.match(debit, /Número de cuenta o CLABE \(opcional\)/)
  assert.match(debit, /name="available"[^>]*required/)
  assert.doesNotMatch(debit, /name="(?:total|statementDate|paymentDueDate|paymentToAvoidInterest)"/)
  ctx.newAccountType = 'Tarjeta de crédito'
  const credit = text(ctx.renderAccountForm())
  for (const field of ['total', 'available', 'statementDate', 'paymentDueDate', 'paymentToAvoidInterest']) {
    assert.match(credit, new RegExp(`name="${field}"[^>]*required`))
  }
  assert.match(credit, /Saldo utilizado \(deuda actual\)/)
  ctx.startAccountEdit({ id: 8, name: 'Mi tarjeta', type: 'Tarjeta de crédito',
    available: '80', total: '100', depositDetails: 'Cuenta 001' })
  const edited = text(ctx.renderAccountForm())
  assert.match(edited, /name="name"[^>]*\.value=Mi tarjeta/)
  assert.match(edited, /name="depositDetails"[^>]*\.value=Cuenta 001/)
})

test('cards keep their categories and sort pending credit by deadline in both independent views', () => {
  const credit = { type: 'Tarjeta de crédito', available: '80', total: '100',
    paymentToAvoidInterest: '20', statementDate: '2026-11-01' }
  const accounts = [
    { ...credit, id: 1, name: 'Luego', paymentDueDate: '2026-12-10' },
    { id: 2, name: 'Zeta efectivo', type: 'Efectivo', available: '20' },
    { ...credit, id: 3, name: 'Cubierto', paymentDueDate: '2026-11-01', paymentTransfers: '20' },
    { ...credit, id: 4, name: 'Vencido', paymentDueDate: '2026-11-24' },
    { id: 5, name: 'Alfa débito', type: 'Tarjeta de débito', available: '10' },
    { ...credit, id: 6, name: 'Hoy', paymentDueDate: '2026-11-26' },
    { ...credit, id: 7, name: 'Sin fecha', paymentDueDate: null },
  ]
  const ctx = { ...methods('salud-financiera'), dashboard: { accounts }, today, familyView: true }
  const original = accounts.map((item) => item.id)
  for (const listView of [false, true]) {
    ctx.cardsListView = listView
    const markup = text(ctx.renderCards())
    assert.deepEqual(names(markup), ['Alfa débito', 'Zeta efectivo', 'Vencido', 'Hoy', 'Luego', 'Cubierto', 'Sin fecha'])
    assert.match(markup, /Nómina \/ Débito \/ Efectivo/)
    assert.match(markup, /<h3 class="card-group-title">Crédito/)
    assert.match(markup, listView ? /class=record-list/ : /class=card-grid/)
    assert.match(markup, /class="card-actions" \?hidden=true/)
  }
  ctx.cardsListView = false
  ctx.plansListView = false
  assert.ok(toggle(ctx.renderCards()))
  assert.equal(ctx.cardsListView, true)
  assert.equal(ctx.plansListView, false)
  assert.deepEqual(accounts.map((item) => item.id), original)
})

test('plans sort by next contribution, not completion date, and preserve selection and actions when toggled', () => {
  const base = { goal: '100', saved: '0', remaining: '100', periodUnit: 'mes',
    contribution: '10', contributionDay: 28, visible: 1, startDate: '2026-01-01' }
  const plans = [
    { ...base, id: 1, name: 'Luego', contributionDay: 30 },
    { ...base, id: 2, name: 'Completado', saved: '100', remaining: '0' },
    { ...base, id: 3, name: 'Hoy', contributionDay: 26 },
    { ...base, id: 4, name: 'Semanal', periodUnit: 'semana', contributionDay: 5 },
    { ...base, id: 5, name: 'Sin configurar', contribution: null },
  ]
  const ctx = { ...methods('salud-financiera'), dashboard: { plans }, today, selectedPlan: plans[2] }
  for (const listView of [false, true]) {
    ctx.plansListView = listView
    const markup = text(ctx.renderPlans())
    assert.deepEqual(names(markup), ['Hoy', 'Semanal', 'Luego', 'Completado', 'Sin configurar'])
    assert.match(markup, /Registrar movimiento/)
    assert.match(markup, /Editar plan/)
    assert.match(markup, /<finance-related-movements relation="plan"/)
    assert.match(markup, /.relationId=3/)
    assert.match(markup, listView ? /class=record-list/ : /class=card-grid/)
  }
  assert.ok(toggle(ctx.renderPlans()))
  assert.equal(ctx.plansListView, false)
  assert.equal(ctx.selectedPlan.id, 3)
})

test('subscriptions sort weekly and monthly billings, keeping cancelled and undefined billings at the end', () => {
  const base = { status: 'activa', frequency: 'Mensual', cost: '100', monetized: '0', type: 'suscripcion',
    billingDay: 28, startDate: '2026-01-01' }
  const items = [
    { ...base, id: 1, name: 'Luego', billingDay: 30 },
    { ...base, id: 2, name: 'Cancelada', status: 'cancelada', billingDay: 26 },
    { ...base, id: 3, name: 'Hoy', billingDay: 26 },
    { ...base, id: 4, name: 'Semanal', frequency: 'Semanal', billingDay: 5 },
    { ...base, id: 5, name: 'Sin fecha', billingDay: null },
  ]
  const ctx = { ...methods('finance-subscriptions'), items, today, selectedSubscription: items[2], familyView: true }
  for (const listView of [false, true]) {
    ctx.listView = listView
    const markup = text(ctx.render())
    assert.deepEqual(names(markup), ['Hoy', 'Semanal', 'Luego', 'Cancelada', 'Sin fecha'])
    assert.match(markup, listView ? /class=record-list/ : /class=subscription-grid/)
    assert.match(markup, /Ver movimientos/)
    assert.match(markup, /<finance-related-movements relation="subscription"/)
    assert.match(markup, /.relationId=3/)
    assert.match(markup, /\?hidden=true/)
    assert.doesNotMatch(markup, />Registrar movimiento<\/button>/)
  }
  ctx.familyView = false
  assert.match(text(ctx.render()), /<button class="text-button" type="button" \?disabled=[^>]*@click=[^>]*>Registrar movimiento<\/button>/)
  assert.ok(toggle(ctx.render()))
  assert.equal(ctx.listView, false)
  assert.equal(ctx.selectedSubscription.id, 3)
})

test('loans group Me deben and Yo debo, ordering each commitment with completed loans last in both views', () => {
  const base = { principal: '100', paid: '0', remaining: '100', startDate: '2026-01-01' }
  const items = [
    { ...base, id: 1, name: 'Cobrar luego', type: 'me_deben', commitmentDate: '2026-12-05' },
    { ...base, id: 2, name: 'Pagar luego', type: 'debo', commitmentDate: '2026-12-02' },
    { ...base, id: 3, name: 'Cobrar vencido', type: 'me_deben', commitmentDate: '2026-11-25' },
    { ...base, id: 4, name: 'Pagar vencido', type: 'debo', commitmentDate: '2026-11-20' },
    { ...base, id: 5, name: 'Cobro liquidado', type: 'me_deben', commitmentDate: '2026-11-01', remaining: '0' },
    { ...base, id: 6, name: 'Pago liquidado', type: 'debo', commitmentDate: '2026-11-01', remaining: '0' },
  ]
  const ctx = { ...methods('finance-loans'), items, accounts: [], selectedId: 3, familyView: true }
  for (const listView of [false, true]) {
    ctx.listView = listView
    const markup = text(ctx.render())
    assert.deepEqual(names(markup), ['Cobrar vencido', 'Cobrar luego', 'Cobro liquidado', 'Pagar vencido', 'Pagar luego', 'Pago liquidado'])
    assert.match(markup, /aria-label=Me deben/)
    assert.match(markup, /aria-label=Yo debo/)
    assert.match(markup, listView ? /class=record-list/ : /class=card-grid/)
    assert.match(markup, /<finance-related-movements relation="loan"/)
    assert.match(markup, /.relationId=3/)
    assert.match(markup, /class="card-actions" \?hidden=true/)
  }
  assert.ok(toggle(ctx.render()))
  assert.equal(ctx.listView, false)
  assert.equal(ctx.selectedId, 3)
})
