import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { accountThemeStyle } from './account-theme.js'

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
const methods = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(finance))
  .filter(([, descriptor]) => typeof descriptor.value === 'function')
  .map(([name, descriptor]) => [name, descriptor.value]))
const accounts = [
  { id: 10, name: 'Mi débito', ownerId: 7, ownerName: 'Eric', ownerTheme: 'azul', available: '100' },
  { id: 20, name: 'Su tarjeta', ownerId: 8, ownerName: 'Liliam', ownerTheme: 'rosa', available: '50' },
]
const state = (changes = {}) => ({
  ...methods, familyAvailable: true, familyView: false, movementMode: 'family', movementOperation: 'transfer',
  familyTransferData: { userId: 7, accounts }, today: new Date(2026, 10, 27),
  dashboard: { accounts: [accounts[0]], categories: [], plans: [], subscriptions: [], loans: [] },
  ...changes,
})
function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('family form separates own origins from family destinations with owner name and color', () => {
  const markup = text(state().renderMovementForm())
  assert.match(markup, /Movimiento familiar · Pago o transferencia/)
  const origin = markup.slice(markup.indexOf('Cuenta de origen · Tus cuentas'), markup.indexOf('Cuenta de destino · Tu familia'))
  const destination = markup.slice(markup.indexOf('Cuenta de destino · Tu familia'))
  assert.match(origin, /name=originAccountId value=10/)
  assert.doesNotMatch(origin, /Liliam/)
  assert.match(destination, /name=destinationAccountId value=20/)
  assert.match(destination, /Liliam/)
  assert.match(destination, /--surface:hsl\(330 58% 94%\)/)
  assert.doesNotMatch(destination, /name=destinationAccountId value=10/)
  assert.doesNotMatch(markup, /<select\s+name="(?:operation|planId|subscriptionId|categoryId)"/)
  assert.match(text(state({ familyTransferData: null, familyTransferLoading: true }).renderMovementForm()), /Cargando cuentas familiares/)
  assert.match(text(state({ familyTransferData: { userId: 7, accounts: [accounts[0]] } }).renderMovementForm()),
    /No hay cuentas de otros integrantes/)
})

test('family account cards use each owner theme while individual cards keep inherited colors', () => {
  const ctx = state()
  assert.match(text(ctx.renderBankCard(accounts[1])), /style=--surface:hsl\(330 58% 94%\)/)
  assert.equal(accountThemeStyle({}), '')
  assert.equal(accountThemeStyle({ ownerTheme: 'invalid; color: red' }), '')
  assert.match(accountThemeStyle({ ownerTheme: 'rosa', ownerAppearance: 'night' }), /330 48% 17%/)
  assert.match(accountThemeStyle({ ownerTheme: 'oscuro', ownerAppearance: 'night' }), /--surface:#15171a/)
})

test('special mode loads the current accounts and stale requests never restore cleared family data', async (t) => {
  const ctx = state({ familyTransferData: null })
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, '/api/family-transfer-accounts')
    return new Response(JSON.stringify({ userId: 7, accounts }))
  })
  await ctx.loadFamilyTransferAccounts()
  assert.equal(ctx.familyTransferData.accounts.length, 2)
  assert.equal(ctx.familyTransferLoading, false)
  let resolve
  t.mock.method(globalThis, 'fetch', () => new Promise((done) => { resolve = done }))
  const pending = ctx.loadFamilyTransferAccounts()
  ctx.familyTransferRequest++
  ctx.familyTransferData = null
  resolve(new Response(JSON.stringify({ userId: 7, accounts })))
  await pending
  assert.equal(ctx.familyTransferData, null)
})

test('saving the special movement sends one explicit transfer with no unrelated relations', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'FormData', function () {
    return new Map([['originAccountId', '10'], ['destinationAccountId', '20'], ['amount', '40.25'], ['date', '2026-11-27']])
  })

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ id: 1 }))
  })
  const ctx = state({ refreshDashboard: async () => {} })
  await ctx.handleSaveMovement({ preventDefault() {}, currentTarget: {} })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/movements')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    operation: 'transfer', familyTransfer: true, amount: '40.25', date: '2026-11-27',
    originAccountId: '10', destinationAccountId: '20', categoryId: null, planId: null, subscriptionId: null,
  })
  assert.equal(ctx.showMovementForm, false)
})

test('leaving family mode invalidates a late account lookup and its error', async (t) => {
  let reject
  t.mock.method(globalThis, 'fetch', () => new Promise((resolve, fail) => { reject = fail }))
  const ctx = state()
  const pending = ctx.loadFamilyTransferAccounts()
  ctx.selectMovementMode({ currentTarget: { checked: true, value: 'normal' } })
  reject(new Error('Unavailable'))
  await pending
  assert.equal(ctx.familyTransferData, null)
  assert.equal(ctx.familyTransferLoading, false)
  assert.equal(ctx.error, '')
})

test('received movements cannot open an edit form', () => {
  const recipient = state()
  recipient.startMovementEdit({ id: 1, recipientUserId: 8, canEdit: false })
  assert.match(recipient.error, /Solo quien envió/)
  assert.notEqual(recipient.showMovementForm, true)
})

test('family cards expose special registration only on other owners and preload the destination', () => {
  const ctx = state({
    familyView: true, dashboard: { viewerId: 7 }, loadFamilyTransferAccounts() {},
  })
  const card = { ...accounts[1], type: 'Tarjeta de crédito', paymentToAvoidInterest: '25.50' }
  assert.match(text(ctx.renderBankCard(card)), /Registrar movimiento especial/)
  assert.doesNotMatch(text(ctx.renderBankCard(accounts[0])), /Registrar movimiento especial/)
  assert.doesNotMatch(text(state().renderBankCard(card)), /Registrar movimiento especial/)
  ctx.startFamilyMovement(card)
  assert.equal(ctx.familyView, true)
  assert.equal(ctx.movementMode, 'family')
  assert.equal(ctx.movementOperation, 'transfer')
  assert.equal(ctx.newMovementDefaults.destinationAccountId, 20)
  assert.equal(ctx.newMovementDefaults.amount, '25.50')
  assert.equal(ctx.showMovementForm, true)
})

test('family registration restricts the form to the special mode and saves without changing views', async (t) => {
  const ctx = state({ familyView: true })
  const markup = text(ctx.renderMovementForm())
  assert.match(markup, /Movimiento familiar · Pago o transferencia/)
  assert.doesNotMatch(markup, /Registro normal|Abono a préstamo \(opcional\)|Suscripción relacionada \(opcional\)/)
  ctx.selectMovementMode({ currentTarget: { checked: true, value: 'normal' } })
  assert.equal(ctx.movementMode, 'family')
  t.mock.method(globalThis, 'FormData', function () {
    return new Map([['originAccountId', '10'], ['destinationAccountId', '20'], ['amount', '25'], ['date', '2026-11-27']])
  })
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ id: 1 }))
  })
  ctx.refreshDashboard = async () => {}
  await ctx.handleSaveMovement({ preventDefault() {}, currentTarget: {} })
  assert.equal(calls[0].url, '/api/movements')
  assert.equal(JSON.parse(calls[0].options.body).familyTransfer, true)
  assert.equal(ctx.familyView, true)
  ctx.movementMode = 'normal'
  await ctx.handleSaveMovement({ preventDefault() {}, currentTarget: {} })
  assert.equal(calls.length, 1)
  assert.match(ctx.error, /solo puedes registrar movimientos especiales/)
})
