import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pool } from '../../server/db.js'
import { confirmAccountPayment, createAccount, deleteAccount, getDashboardData, updateAccount } from './dashboard.js'
import { handleFinanceRoute } from './routes.js'

test('cash creation and editing persist only name, type and available balance', async (t) => {
  const calls = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    calls.push({ sql, params })
    return [{ insertId: 9, affectedRows: 1 }]
  })
  const input = {
    name: 'Cartera', type: 'Efectivo', available: '250.50',
    total: '1000', statementDate: '2026-11-18',
    paymentDueDate: '2026-12-01', paymentToAvoidInterest: '100',
  }
  assert.deepEqual(await createAccount(7, input), { id: 9 })
  assert.deepEqual(calls[0].params, [7, 'Cartera', 'Efectivo', null, '250.50', null, null, null, null])
  await updateAccount(7, 9, input)
  assert.deepEqual(calls[1].params, ['Cartera', 'Efectivo', null, '250.50', null, null, null, null, 9, 7])
  assert.match(calls[1].sql, /WHERE id = \? AND id_usuario = \?/)
})

test('cash still requires a valid available balance and credit retains its required fields', async () => {
  for (const available of [null, '', '-1', 'abc']) {
    await assert.rejects(createAccount(7, { name: 'Cartera', type: 'Efectivo', available }), { statusCode: 400 })
  }
  await assert.rejects(createAccount(7, {
    name: 'Credito', type: 'Tarjeta de crédito', available: '250',
  }), { statusCode: 400 })
})

test('an account suggested by a loan cannot be deleted with a misleading database error', async (t) => {
  let rolledBack = false
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => {},
    commit: () => assert.fail('Must not delete'),
    rollback: async () => { rolledBack = true },
    release() {},
    execute: async (sql, params) => {
      assert.doesNotMatch(sql, /^DELETE/)
      if (sql.includes('COUNT(*)')) return [[{ count: 0 }]]
      if (sql.includes('FROM prestamo')) {
        assert.deepEqual(params, [7, 2])
        return [[{ id: 8 }]]
      }
      return [[{ id: 2 }]]
    },
  }))
  await assert.rejects(deleteAccount(7, 2), { statusCode: 409 })
  assert.equal(rolledBack, true)
})

test('dashboard computes all-month activity separately from the capped list and detects only eligible card transfers', async (t) => {
  const calls = []
  t.mock.method(pool, 'execute', async (sql, params = []) => {
    calls.push({ sql, params })
    assert.ok(params.every((value) => value === 7))
    if (sql.includes('AS paymentTransfers')) {
      assert.match(sql, /payment.id_usuario = cuenta.id_usuario/)
      assert.match(sql, /payment.id_cuenta_destino = cuenta.id/)
      assert.match(sql, /payment.id_cuenta_origen IS NOT NULL/)
      assert.match(sql, /payment.id_categoria IS NULL AND payment.id_prestamo IS NULL/)
      assert.match(sql, /payment.fecha > DATE_SUB\(cuenta.fecha_limite_pago, INTERVAL 1 MONTH\)/)
      assert.match(sql, /payment.fecha < DATE_ADD\(CURDATE\(\), INTERVAL 1 DAY\)/)
      return [[{ id: 1, type: 'Tarjeta de crédito', available: '80', total: '100',
        paymentDueDate: '2027-01-10', paymentToAvoidInterest: '100', paymentTransfers: '20' }]]
    }
    if (sql.includes('AS month,')) {
      assert.doesNotMatch(sql, /LIMIT/)
      assert.match(sql, /WHERE m.id_usuario = \?/)
      assert.match(sql, /m.id_prestamo IS NULL AND \(cat.tipo = 'ingreso'/)
      assert.match(sql, /m.id_prestamo IS NULL AND \(cat.tipo = 'gasto'/)
      assert.match(sql, /GROUP BY DATE_FORMAT\(m.fecha, '%Y-%m'\)/)
      return [[{ month: '2026-11', income: '10000.10', expenses: '3000.20' }]]
    }
    if (sql.includes('SELECT m.id')) {
      assert.match(sql, /LIMIT 250/)
      return [Array.from({ length: 250 }, (_, id) => ({ id, amount: '1' }))]
    }
    return [[]]
  })
  const data = await getDashboardData(7)
  assert.equal(data.movements.length, 250)
  assert.deepEqual(data.activityByMonth, [{ month: '2026-11', income: '10000.10', expenses: '3000.20' }])
  assert.equal(data.accounts[0].paymentTransfers, '20')
  assert.ok(calls.length > 2)
})

test('manual confirmation is reversible, owner-scoped and guarded against a stale due date or amount', async (t) => {
  const writes = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    writes.push({ sql, params })
    assert.equal((sql.match(/\?/g) || []).length, params.length)
    assert.match(sql, /WHERE id = \? AND id_usuario = \?/)
    assert.match(sql, /fecha_limite_pago = \? AND pago_para_no_generar_intereses = \?/)
    assert.doesNotMatch(sql, /INSERT INTO movimiento|disponible =/)
    return [{ affectedRows: 1 }]
  })
  const payment = { confirmed: true, paymentDueDate: '2027-01-10', paymentToAvoidInterest: '100.30' }
  await confirmAccountPayment(7, 2, payment)
  assert.deepEqual(writes.at(-1).params, [true, true, 2, 7, '2027-01-10', '100.30'])
  await confirmAccountPayment(7, 2, { ...payment, confirmed: false })
  assert.deepEqual(writes.at(-1).params.slice(0, 2), [false, false])
  for (const bad of [{ confirmed: 'yes' }, { paymentDueDate: '' }, { paymentToAvoidInterest: '-1' }]) {
    await assert.rejects(confirmAccountPayment(7, 2, { ...payment, ...bad }), { statusCode: 400 })
  }
  t.mock.method(pool, 'execute', async () => [{ affectedRows: 0 }])
  await assert.rejects(confirmAccountPayment(7, 99, payment), { statusCode: 409 })
})

test('payment confirmation endpoint authenticates and blocks family writes', async (t) => {
  const url = new URL('http://localhost/api/accounts/2/payment-confirmation')
  let written = false
  t.mock.method(pool, 'execute', async (_, params) => {
    written = true
    assert.equal(params[3], 7)
    return [{ affectedRows: 1 }]
  })
  const helpers = {
    getUserId: async () => null,
    readJson: () => assert.fail('Must authenticate first'),
    sendJson: () => assert.fail('Must authenticate first'),
  }
  assert.equal(await handleFinanceRoute({ method: 'PUT' }, {}, url, helpers), true)
  assert.equal(written, false)
  url.searchParams.set('view', 'family')
  await assert.rejects(handleFinanceRoute({ method: 'PUT' }, {}, url, {
    ...helpers, getUserId: async () => 7,
  }), { statusCode: 403 })
  url.search = ''
  await handleFinanceRoute({ method: 'PUT' }, {}, url, {
    getUserId: async () => 7,
    readJson: async () => ({ confirmed: true, paymentDueDate: '2027-01-10', paymentToAvoidInterest: '100' }),
    sendJson: (_, status, result) => {
      assert.equal(status, 200)
      assert.deepEqual(result, { ok: true, id: 2 })
    },
  })
  assert.equal(written, true)
})
