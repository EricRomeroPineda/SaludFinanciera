import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pool } from '../../server/db.js'
import { createLoan, deleteLoan, getLoans, updateLoan } from './loans.js'
import { deleteMovement, getRelatedMovements, saveMovement } from './movements.js'
import { handleFinanceRoute } from './routes.js'

const input = {
  name: 'Ana', type: 'me_deben', principal: '100.00', startDate: '2026-11-19',
  commitmentDate: '2026-12-19', accountId: 2, recordDisbursement: true, notes: 'Préstamo personal',
}

function ledger(t) {
  const state = {
    accounts: [{ id: 2, userId: 7, available: 1000 }, { id: 3, userId: 8, available: 500 }],
    loans: [], movements: [], nextLoan: 1, nextMovement: 1,
  }
  const calls = []
  let snapshot
  const connection = {
    async beginTransaction() { snapshot = structuredClone(state) },
    async commit() { snapshot = null },
    async rollback() { Object.assign(state, snapshot); snapshot = null },
    release() {},
    async execute(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM movimiento_evidencia')) return [[]]
      if (sql.startsWith('INSERT INTO prestamo')) {
        const [userId, name, type, principal, startDate, commitmentDate, accountId, legacy, notes] = params
        const id = state.nextLoan++
        state.loans.push({ id, userId, name, type, principal, startDate, commitmentDate, accountId, legacy, notes })
        return [{ insertId: id }]
      }
      if (sql.includes('FROM prestamo WHERE id_usuario')) {
        return [state.loans.filter((loan) => loan.userId === params[0] && params.slice(1).includes(loan.id))
          .map((loan) => ({ id: loan.id, tipo: loan.type, monto: loan.principal, startDate: loan.startDate }))]
      }
      if (sql.startsWith('SELECT') && sql.includes('FROM prestamo WHERE id =')) {
        return [state.loans.filter((loan) => loan.id === params[0] && loan.userId === params[1])]
      }
      if (sql.startsWith('UPDATE prestamo')) {
        const [name, commitmentDate, accountId, notes, id, userId] = params
        Object.assign(state.loans.find((loan) => loan.id === id && loan.userId === userId), { name, commitmentDate, accountId, notes })
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('DELETE FROM prestamo')) {
        state.loans = state.loans.filter((loan) => loan.id !== params[0] || loan.userId !== params[1])
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('SELECT id FROM cuenta WHERE')) {
        return [state.accounts.filter((account) => account.id === params[0] && account.userId === params[1])]
      }
      if (sql.includes('SELECT id, disponible FROM cuenta')) {
        return [state.accounts.filter((account) => account.userId === params[0] && params.slice(1).includes(account.id))
          .map((account) => ({ id: account.id, disponible: account.available }))]
      }
      if (sql.startsWith('UPDATE cuenta SET disponible')) {
        const [amount, id, userId] = params
        const account = state.accounts.find((row) => row.id === id && row.userId === userId)
        const subtract = sql.includes('disponible -')
        if (!account || (subtract && account.available < Number(amount))) return [{ affectedRows: 0 }]
        account.available = Math.round((account.available + Number(amount) * (subtract ? -1 : 1)) * 100) / 100
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('SELECT COALESCE(SUM(monto), 0)')) {
        const paid = state.movements.filter((row) => row.id_usuario === params[0] && row.id_prestamo === params[1] &&
          row.clase_prestamo === 'abono' && row.id !== params[2]).reduce((total, row) => total + Math.round(Number(row.monto) * 100), 0) / 100
        return [[{ paid: paid.toFixed(2) }]]
      }
      if (sql.startsWith('SELECT') && sql.includes('FROM movimiento WHERE id =')) {
        return [state.movements.filter((row) => row.id === params[0] && row.id_usuario === params[1])]
      }
      if (sql.includes('SELECT id FROM movimiento WHERE id_prestamo')) {
        return [state.movements.filter((row) => row.id_prestamo === params[0] && row.id_usuario === params[1])]
      }
      if (sql.startsWith('INSERT INTO movimiento')) {
        const [id_usuario, id_plan_futuro, id_suscripcion, id_categoria, id_cuenta_origen, id_cuenta_destino, monto, fecha, id_prestamo, clase_prestamo] = params
        const id = state.nextMovement++
        state.movements.push({ id, id_usuario, id_plan_futuro, id_suscripcion, id_categoria, id_cuenta_origen, id_cuenta_destino, monto, fecha, id_prestamo, clase_prestamo })
        return [{ insertId: id }]
      }
      if (sql.startsWith('UPDATE movimiento')) {
        const [id_plan_futuro, id_suscripcion, id_categoria, id_cuenta_origen, id_cuenta_destino, monto, fecha, id_prestamo, clase_prestamo, id, userId] = params
        Object.assign(state.movements.find((row) => row.id === id && row.id_usuario === userId),
          { id_plan_futuro, id_suscripcion, id_categoria, id_cuenta_origen, id_cuenta_destino, monto, fecha, id_prestamo, clase_prestamo })
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('DELETE FROM movimiento')) {
        state.movements = state.movements.filter((row) => row.id !== params[0] || row.id_usuario !== params[1])
        return [{ affectedRows: 1 }]
      }
      assert.fail(sql)
    },
  }
  t.mock.method(pool, 'getConnection', async () => connection)
  return { state, calls }
}

function payment(loanId, amount = '40', type = 'me_deben') {
  return {
    loanId, amount, date: '2026-11-20', operation: type === 'me_deben' ? 'income' : 'expense',
    ...(type === 'me_deben' ? { destinationAccountId: 2 } : { originAccountId: 2 }),
  }
}

for (const type of ['me_deben', 'debo']) {
  test(`new loan ${type} moves money once, repayments reverse the direction, edits and deletion update balances`, async (t) => {
    const { state } = ledger(t)
    const { id, movementId } = await createLoan(7, { ...input, type })
    assert.equal(state.accounts[0].available, type === 'me_deben' ? 900 : 1100)
    assert.equal(state.movements[0].id_prestamo, id)
    assert.equal(state.movements[0].clase_prestamo, 'desembolso')
    assert.equal(state.movements[0].id, movementId)
    const { id: repayment } = await saveMovement(7, payment(id, '40', type))
    assert.equal(state.accounts[0].available, type === 'me_deben' ? 940 : 1060)
    await saveMovement(7, payment(id, '60', type), repayment)
    assert.equal(state.accounts[0].available, type === 'me_deben' ? 960 : 1040)
    assert.equal(state.loans[0].principal, '100.00')
    await deleteMovement(7, repayment)
    assert.equal(state.accounts[0].available, type === 'me_deben' ? 900 : 1100)
    assert.equal(state.movements.length, 1)
  })
}

test('historical loans create no movement and do not change balances; no payments before registration start', async (t) => {
  const { state } = ledger(t)
  const { id, movementId } = await createLoan(7, { ...input, accountId: null, recordDisbursement: false })
  assert.equal(movementId, null)
  assert.equal(state.accounts[0].available, 1000)
  assert.equal(state.movements.length, 0)
  await assert.rejects(saveMovement(7, { ...payment(id), date: '2026-11-18' }), { statusCode: 400 })
  await saveMovement(7, payment(id, '100'))
  assert.equal(state.accounts[0].available, 1100)
})

test('overpayments, incorrect direction, foreign accounts and foreign loans fail without any balance mutation', async (t) => {
  const { state } = ledger(t)
  const { id } = await createLoan(7, input)
  await saveMovement(7, payment(id, '80'))
  const snapshot = structuredClone(state)
  for (const [userId, data, statusCode] of [
    [7, payment(id, '20.01'), 409],
    [7, { ...payment(id), operation: 'expense', originAccountId: 2, destinationAccountId: null }, 400],
    [7, { ...payment(id, '10'), destinationAccountId: 3 }, 404],
    [8, payment(id, '10'), 404],
    [7, { ...payment(id, '10'), categoryId: 1 }, 400],
    [7, { ...payment(id, '10'), planId: 1 }, 400],
    [7, { ...payment(id, '10'), subscriptionId: 1 }, 400],
    [7, { ...payment(id, '10'), loanKind: 'desembolso' }, 400],
  ]) {
    await assert.rejects(saveMovement(userId, data), { statusCode })
    assert.deepEqual(state, snapshot)
  }
})

test('failed new loan disbursement rolls back the loan itself and never leaves half-saved balances', async (t) => {
  const { state } = ledger(t)
  await assert.rejects(createLoan(7, { ...input, principal: '1000.01' }), { statusCode: 409 })
  assert.equal(state.loans.length, 0)
  assert.equal(state.movements.length, 0)
  assert.equal(state.accounts[0].available, 1000)
  await assert.rejects(createLoan(7, { ...input, accountId: 3 }), { statusCode: 404 })
  assert.equal(state.loans.length, 0)
  await assert.rejects(createLoan(7, { ...input, accountId: null }), { statusCode: 400 })
  assert.equal(state.loans.length, 0)
})

test('desembolsos cannot be edited or deleted; loan metadata edits preserve original principal and direction', async (t) => {
  const { state } = ledger(t)
  const { id, movementId } = await createLoan(7, input)
  await assert.rejects(saveMovement(7, payment(id), movementId), { statusCode: 409 })
  await assert.rejects(deleteMovement(7, movementId), { statusCode: 409 })
  await updateLoan(7, id, { ...input, name: 'Ana nueva', commitmentDate: '2027-01-19', principal: '999', type: 'debo' })
  assert.equal(state.loans[0].name, 'Ana nueva')
  assert.equal(state.loans[0].commitmentDate, '2027-01-19')
  assert.equal(state.loans[0].principal, '100.00')
  assert.equal(state.loans[0].type, 'me_deben')
  await assert.rejects(deleteLoan(7, id), { statusCode: 409 })
  await assert.rejects(updateLoan(8, id, input), { statusCode: 404 })
  await assert.rejects(deleteLoan(8, id), { statusCode: 404 })
})

test('deleting historical loans without movements is permitted and cents remain exact at payoff', async (t) => {
  const { state } = ledger(t)
  const { id } = await createLoan(7, { ...input, principal: '0.30', recordDisbursement: false })
  await saveMovement(7, payment(id, '0.10'))
  await saveMovement(7, payment(id, '0.20'))
  assert.equal(state.accounts[0].available, 1000.3)
  await assert.rejects(saveMovement(7, payment(id, '0.01')), { statusCode: 409 })
  await deleteMovement(7, 1)
  await deleteMovement(7, 2)
  await deleteLoan(7, id)
  assert.equal(state.loans.length, 0)
  assert.equal(state.accounts[0].available, 1000)
})

test('reassigning a repayment locks both loan IDs in order and excludes its old amount when validating edits', async (t) => {
  const { state, calls } = ledger(t)
  const first = await createLoan(7, { ...input, recordDisbursement: false })
  const second = await createLoan(7, { ...input, recordDisbursement: false })
  const { id } = await saveMovement(7, payment(first.id, '100'))
  await saveMovement(7, payment(first.id, '90'), id)
  await saveMovement(7, payment(second.id, '80'), id)
  assert.equal(state.movements[0].id_prestamo, second.id)
  assert.equal(state.accounts[0].available, 1080)
  const locks = calls.filter(({ sql }) => sql.includes('FROM prestamo WHERE id_usuario'))
  assert.deepEqual(locks.at(-1).params, [7, first.id, second.id])
})

test('loan reads sum only repayments and all history queries retain owner filtering and movement IDs', async (t) => {
  const calls = []
  t.mock.method(pool, 'execute', async (sql, params) => { calls.push({ sql, params }); return [[]] })
  await getLoans(7)
  assert.match(calls[0].sql, /clase_prestamo = 'abono'/)
  assert.match(calls[0].sql, /p.monto - COALESCE\(a.paid, 0\) AS remaining/)
  assert.deepEqual(calls[0].params, [7, 7])
  await getRelatedMovements(7, 'loan', 5)
  assert.match(calls[1].sql, /SELECT m.id/)
  assert.match(calls[1].sql, /WHERE m.id_usuario = \? AND m.id_prestamo = \?/)
  assert.doesNotMatch(calls[1].sql, /LIMIT/)
  assert.deepEqual(calls[1].params, [7, 5])
})

test('loan creation rejects missing/invalid dates, zero amounts, unknown types and ambiguous mode', async () => {
  for (const change of [
    { name: '' }, { type: 'otro' }, { principal: '0' }, { principal: '-1' },
    { startDate: '2026-02-30' }, { commitmentDate: '2026-11-18' }, { commitmentDate: '' },
    { recordDisbursement: undefined },
  ]) await assert.rejects(createLoan(7, { ...input, ...change }), { statusCode: 400 })
})

test('loan routes require authentication and family view never permits loan mutations', async () => {
  for (const [method, path] of [['GET', '/api/loans'], ['POST', '/api/loans'], ['PUT', '/api/loans/8'], ['DELETE', '/api/loans/8']]) {
    assert.equal(await handleFinanceRoute({ method }, {}, new URL(`http://localhost${path}`), {
      getUserId: async () => null,
      readJson: () => assert.fail('Must not read'),
      sendJson: () => assert.fail('Must not succeed'),
    }), true)
    if (method !== 'GET') {
      await assert.rejects(handleFinanceRoute({ method }, {}, new URL(`http://localhost${path}?view=family`), {
        getUserId: async () => 7,
        readJson: () => assert.fail('Must not read'),
        sendJson: () => assert.fail('Must not succeed'),
      }), { statusCode: 403 })
    }
  }
})
