import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pool } from '../../server/db.js'
import { deleteMovement, getRelatedMovements, saveMovement } from './movements.js'
import { getFamilyTransferAccounts, getFamilyView } from './family-view.js'
import { getDashboardData } from './dashboard.js'
import { getCalendarData } from './calendar.js'
import { cardPaymentStatus } from '../account-summary.js'
import { handleFinanceRoute } from './routes.js'

const transfer = { operation: 'transfer', familyTransfer: true, amount: '40.25', date: '2026-11-27',
  originAccountId: 10, destinationAccountId: 20 }

function ledger(t) {
  const state = {
    members: [7, 8],
    accounts: [{ id: 10, id_usuario: 7, disponible: 100, tipo: 'Tarjeta de débito' }, { id: 20, id_usuario: 8, disponible: 50, tipo: 'Tarjeta de crédito' },
      { id: 30, id_usuario: 9, disponible: 100, tipo: 'Efectivo' }],
    movements: [],
  }
  const calls = []
  let snapshot
  const connection = {
    async beginTransaction() { snapshot = structuredClone(state) },
    async commit() { calls.push({ sql: 'COMMIT' }) },
    async rollback() { Object.assign(state, snapshot); calls.push({ sql: 'ROLLBACK' }) },
    release() {},
    async execute(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM familia_integrante sender')) {
        assert.match(sql, /FOR UPDATE/)
        return [state.members.includes(params[0]) ? state.members.map((userId) => ({ userId })) : []]
      }
      if (sql.includes('FROM cuenta') && sql.startsWith('SELECT')) {
        const family = sql.includes('tipo, id_usuario')
        assert.match(sql, /ORDER BY id FOR UPDATE/)
        return [state.accounts.filter((account) => family
          ? params.includes(account.id)
          : account.id_usuario === params[0] && params.slice(1).includes(account.id))]
      }
      if (sql.startsWith('UPDATE cuenta SET disponible')) {
        const [amount, id, ownerId] = params
        if (state.failDestination && id === 20) return [{ affectedRows: 0 }]
        const account = state.accounts.find((account) => account.id === id && account.id_usuario === ownerId)
        const subtract = sql.includes('disponible -')
        if (!account || (subtract && account.disponible < Number(amount))) return [{ affectedRows: 0 }]
        account.disponible = Math.round((account.disponible + Number(amount) * (subtract ? -1 : 1)) * 100) / 100
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('INSERT INTO movimiento')) {
        const [id_usuario, id_plan_futuro, id_suscripcion, id_categoria, id_cuenta_origen, id_cuenta_destino,
          monto, fecha, id_prestamo, clase_prestamo, id_usuario_destino] = params
        state.movements.push({ id: 1, id_usuario, id_plan_futuro, id_suscripcion, id_categoria,
          id_cuenta_origen, id_cuenta_destino, monto, fecha, id_prestamo, clase_prestamo, id_usuario_destino })
        return [{ insertId: 1 }]
      }
      if (sql.startsWith('SELECT') && sql.includes('FROM movimiento WHERE id =')) {
        return [state.movements.filter((movement) => movement.id === params[0] && movement.id_usuario === params[1])]
      }
      if (sql.startsWith('UPDATE movimiento')) {
        const [id_plan_futuro, id_suscripcion, id_categoria, id_cuenta_origen, id_cuenta_destino,
          monto, fecha, id_prestamo, clase_prestamo, id_usuario_destino, id, ownerId] = params
        const movement = state.movements.find((movement) => movement.id === id && movement.id_usuario === ownerId)
        Object.assign(movement, { id_plan_futuro, id_suscripcion, id_categoria, id_cuenta_origen,
          id_cuenta_destino, monto, fecha, id_prestamo, clase_prestamo, id_usuario_destino })
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('FROM movimiento_evidencia')) return [[]]
      if (sql.startsWith('DELETE FROM movimiento')) {
        state.movements = state.movements.filter((movement) => movement.id !== params[0])
        return [{ affectedRows: 1 }]
      }
      assert.fail(sql)
    },
  }
  t.mock.method(pool, 'getConnection', async () => connection)
  return { state, calls }
}

test('one family transfer updates both owners atomically and edits/deletion reverse both sides', async (t) => {
  const { state, calls } = ledger(t)
  assert.equal((await saveMovement(7, transfer)).id, 1)
  assert.deepEqual(state.accounts.map((account) => account.disponible), [59.75, 90.25, 100])
  assert.equal(state.movements.length, 1)
  assert.equal(state.movements[0].id_usuario_destino, 8)
  await saveMovement(7, { ...transfer, amount: '25.50' }, 1)
  assert.deepEqual(state.accounts.map((account) => account.disponible), [74.5, 75.5, 100])
  assert.equal(state.movements.length, 1)
  state.members = [7]
  await deleteMovement(7, 1)
  assert.deepEqual(state.accounts.map((account) => account.disponible), [100, 50, 100])
  assert.equal(state.movements.length, 0)
  assert.equal(calls.filter(({ sql }) => sql === 'COMMIT').length, 3)
})

test('only an explicit family transfer can fund another current member, never debit them', async (t) => {
  const { state, calls } = ledger(t)
  const original = structuredClone(state)
  for (const [input, statusCode] of [
    [{ ...transfer, familyTransfer: false }, 404],
    [{ ...transfer, familyTransfer: 'true' }, 404],
    [{ ...transfer, originAccountId: 20, destinationAccountId: 10 }, 403],
    [{ ...transfer, destinationAccountId: 30 }, 403],
    [{ ...transfer, destinationAccountId: 10 }, 400],
    [{ ...transfer, operation: 'expense', destinationAccountId: null }, 400],
    [{ ...transfer, categoryId: 4 }, 400],
    [{ ...transfer, amount: '100.01' }, 409],
  ]) {
    await assert.rejects(saveMovement(7, input), { statusCode })
    assert.deepEqual(state, original)
  }
  state.members = [7]
  await assert.rejects(saveMovement(7, transfer), { statusCode: 403 })
  assert.ok(!calls.some(({ sql }) => sql.startsWith('UPDATE cuenta')))
})

test('recipient cannot edit/delete; failed reversal or changed membership leaves both balances intact', async (t) => {
  const { state } = ledger(t)
  await saveMovement(7, transfer)
  const original = structuredClone(state)
  await assert.rejects(saveMovement(8, transfer, 1), { statusCode: 404 })
  await assert.rejects(deleteMovement(8, 1), { statusCode: 404 })
  assert.deepEqual(state, original)
  state.members = [7]
  await assert.rejects(saveMovement(7, { ...transfer, amount: '30' }, 1), { statusCode: 403 })
  assert.deepEqual(state.accounts, original.accounts)
  state.accounts[1].disponible = 0
  const before = structuredClone(state)
  await assert.rejects(deleteMovement(7, 1), { statusCode: 409 })
  assert.deepEqual(state, before)
})

test('a failed destination update rolls back the origin debit and leaves no movement', async (t) => {
  const { state, calls } = ledger(t)
  state.failDestination = true
  const original = structuredClone(state)
  await assert.rejects(saveMovement(7, transfer), { statusCode: 409 })
  assert.deepEqual(state, original)
  assert.equal(calls.at(-1).sql, 'ROLLBACK')
})

test('converting a family transfer to a normal expense and back adjusts balances without duplicates', async (t) => {
  const { state } = ledger(t)
  await saveMovement(7, transfer)
  await saveMovement(7, { operation: 'expense', originAccountId: 10, amount: '20', date: transfer.date }, 1)
  assert.deepEqual(state.accounts.map((account) => account.disponible), [80, 50, 100])
  assert.equal(state.movements[0].id_usuario_destino, null)
  await saveMovement(7, transfer, 1)
  assert.deepEqual(state.accounts.map((account) => account.disponible), [59.75, 90.25, 100])
  assert.equal(state.movements.length, 1)
  assert.equal(state.movements[0].id_usuario_destino, 8)
})

function sharedReadData(t) {
  const calls = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    calls.push({ sql, params })
    if (sql.includes('SELECT f.id')) return [[{ id: 4, name: 'Familia', creatorId: 7 }]]
    if (sql.includes('SELECT u.id')) return [[
      { id: 7, name: 'Eric', theme: 'azul', appearance: 'day' },
      { id: 8, name: 'Liliam', theme: 'rosa', appearance: 'day' },
    ]]
    if (sql.includes('SELECT m.id')) {
      assert.match(sql, /WHERE \(m.id_usuario = \? OR m.id_usuario_destino = \?\)/)
      assert.equal(params[0], params[1])
      assert.match(sql, /destination.id_usuario = COALESCE\(m.id_usuario_destino, m.id_usuario\)/)
      return [[{ id: 1, movementOwnerId: 7, recipientUserId: 8, senderName: 'Eric', recipientName: 'Liliam',
        originAccount: 'Débito', destinationAccount: 'Crédito', amount: '40.25', date: '2026-11-27',
        originAccountId: 10, destinationAccountId: 20 }]]
    }
    if (sql.includes('AS paymentTransfers')) {
      assert.match(sql, /payment.id_usuario_destino = cuenta.id_usuario/)
      return [[{ id: 20, name: 'Crédito', type: 'Tarjeta de crédito', available: '90.25', total: '100',
        paymentTransfers: '40.25', paymentDueDate: '2026-11-30', paymentToAvoidInterest: '50' }]]
    }
    if (sql.includes('FROM cuenta')) return [[{ id: 20, name: 'Crédito', ownerId: 8, available: '90.25' }]]
    if (sql.includes('AS day,')) return [[{ day: '2026-11-27', count: '1', income: '0', expenses: '0' }]]
    return [[]]
  })
  return calls
}

test('both histories show the same movement, recipient is read-only and the credit payment is counted', async (t) => {
  sharedReadData(t)
  const { movements } = await getRelatedMovements(8, 'account', 20)
  assert.equal(movements[0].canEdit, false)
  assert.equal(movements[0].originAccount, 'Débito · Eric')
  assert.equal(movements[0].destinationAccount, 'Crédito · Liliam')
  const own = await getDashboardData(7)
  assert.equal(own.movements[0].canEdit, true)
  const recipient = await getDashboardData(8)
  assert.equal(recipient.movements[0].canEdit, false)
  assert.equal(cardPaymentStatus(recipient.accounts[0], new Date(2026, 10, 27)).remaining, 9.75)
  const calendar = await getCalendarData(8, '2026-11', 'all')
  assert.equal(calendar.movements[0].canEdit, false)
})

test('family reads deduplicate the transfer and daily counts and provide owner colors', async (t) => {
  sharedReadData(t)
  const url = new URL('http://localhost/api/calendar?month=2026-11&scope=all')
  const calendar = await getFamilyView(7, 'calendar', url)
  assert.equal(calendar.movements.length, 1)
  assert.deepEqual(calendar.days, [{ day: '2026-11-27', count: 1, income: 0, expenses: 0 }])
  assert.equal((await getFamilyView(7, 'dashboard', url)).movements.length, 1)
  assert.equal((await getFamilyView(7, 'movements',
    new URL('http://localhost/api/movements?relation=account&id=20'))).movements.length, 1)
  const data = await getFamilyTransferAccounts(7)
  assert.equal(data.userId, 7)
  assert.equal(data.accounts[0].ownerName, 'Liliam')
  assert.equal(data.accounts[0].ownerTheme, 'rosa')
})

test('family account lookup requires authentication and active membership', async (t) => {
  t.mock.method(pool, 'execute', async (sql) => {
    assert.match(sql, /SELECT f.id/)
    return [[]]
  })
  await assert.rejects(getFamilyTransferAccounts(7), { statusCode: 403 })
  assert.equal(await handleFinanceRoute({ method: 'GET' }, {},
    new URL('http://localhost/api/family-transfer-accounts'), {
      getUserId: async () => null,
      readJson: () => assert.fail('Must not read'),
      sendJson: () => assert.fail('Must not return accounts'),
    }), true)
})

test('family transfers cannot use credit as origin, even with an explicit request', async (t) => {
  const { state } = ledger(t)
  state.accounts[0].tipo = 'Tarjeta de crédito'
  const before = structuredClone(state)
  await assert.rejects(saveMovement(7, transfer), { statusCode: 400 })
  assert.deepEqual(state, before)
})

test('only subscription payments can use credit as origin', async (t) => {
  const calls = []
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    async execute(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM cuenta')) return [[{ id: 10, disponible: '100', tipo: 'Tarjeta de crédito' }]]
      if (sql.startsWith('SELECT id FROM suscripciones')) return [[{ id: 5 }]]
      if (sql.startsWith('INSERT')) return [{ insertId: 1 }]
      if (sql.startsWith('UPDATE')) return [{ affectedRows: 1 }]
      assert.fail(sql)
    },
  }))
  const payment = { operation: 'expense', originAccountId: 10, amount: '20', date: transfer.date }
  await assert.rejects(saveMovement(7, payment), { statusCode: 400 })
  assert.equal((await saveMovement(7, { ...payment, subscriptionId: 5 })).id, 1)
  assert.equal(calls.filter(({ sql }) => sql.startsWith('UPDATE cuenta')).length, 1)
})
