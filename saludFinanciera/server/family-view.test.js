import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pool } from '../../server/db.js'
import { getFamilyView } from './family-view.js'
import { handleFinanceRoute } from './routes.js'

function mockFamilyData(t, linked = true) {
  const calls = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    calls.push({ sql, params })
    if (sql.includes('SELECT f.id')) return [linked ? [{ id: 4, name: 'Luna', creatorId: 7 }] : []]
    if (sql.includes('SELECT u.id')) return [[{ id: 7, name: 'Ana' }, { id: 8, name: 'Luis' }]]
    if (sql.includes('FROM suscripciones AS s') || sql.includes('FROM plan_futuro AS p')) return [[]]
    if (sql.includes('FROM prestamo p')) return [[{ id: params[0] * 10, name: 'Deudor', type: 'me_deben', principal: '100', paid: '20', remaining: '80' }]]
    if (sql.includes('COUNT(*) AS count') && sql.includes('GROUP BY DATE')) {
      return [[{ day: '2026-11-18', count: '1', income: '0.10', expenses: '0.20' }]]
    }
    if (sql.includes('SELECT cat.nombre')) return [[{ name: 'Comida', type: 'gasto', total: '0.20', count: '1' }]]
    if (sql.includes('FROM cuenta')) return [[{
      id: params[0] * 10, name: 'Banco', type: 'Tarjeta de crédito',
      available: '10', total: '100', paymentDueDate: '2026-11-18', paymentToAvoidInterest: '90',
    }]]
    if (sql.includes('SELECT m.id')) {
      return [[{ id: params[0], amount: '0.20', date: '2026-11-18', originAccount: 'Banco', originAccountId: params[0] * 10 }]]
    }
    if (sql.includes('FROM categorias')) return [[]]
    assert.fail(sql)
  })
  return calls
}

test('family dashboard combines only current members and tags financial owners', async (t) => {
  const calls = mockFamilyData(t)
  const data = await getFamilyView(7, 'dashboard', new URL('http://localhost/api/dashboard?view=family&userId=99'))
  assert.deepEqual(data.accounts.map((account) => account.name), ['Banco · Ana', 'Banco · Luis'])
  assert.deepEqual(data.accounts.map((account) => account.ownerId), [7, 8])
  assert.equal(data.summary.accountsCount, 2)
  assert.equal(data.summary.availableTotal, 20)
  assert.deepEqual(data.loans.map((loan) => loan.name), ['Deudor · Ana', 'Deudor · Luis'])
  assert.deepEqual(data.movements.map((item) => item.id), [8, 7])
  for (const call of calls.filter(({ sql }) => /FROM cuenta|SELECT m.id/.test(sql))) {
    assert.ok([7, 8].includes(call.params[0]))
    assert.match(call.sql, /id_usuario = \?/)
  }
})

test('family calendar merges daily and category totals without rounding errors and retains all movements', async (t) => {
  mockFamilyData(t)
  const data = await getFamilyView(8, 'calendar', new URL('http://localhost/api/calendar?month=2026-11&scope=all'))
  assert.deepEqual(data.days, [{ day: '2026-11-18', count: 2, income: 0.2, expenses: 0.4 }])
  assert.deepEqual(data.categories, [{ name: 'Comida', type: 'gasto', total: 0.4, count: 2 }])
  assert.equal(data.movements.length, 2)
  assert.deepEqual(data.events.map((event) => event.label), ['Banco · Ana', 'Banco · Luis'])
})

test('after membership removal every combined read rejects before querying financial records', async (t) => {
  const calls = mockFamilyData(t, false)
  for (const resource of ['dashboard', 'calendar', 'subscriptions', 'movements']) {
    await assert.rejects(getFamilyView(7, resource, new URL('http://localhost/api/dashboard')), { statusCode: 403 })
  }
  assert.equal(calls.length, 4)
  assert.ok(calls.every(({ sql }) => sql.includes('SELECT f.id')))
})

test('family reads authenticate and family writes reject without reading bodies or changing data', async (t) => {
  t.mock.method(pool, 'execute', () => assert.fail('Must not query'))
  for (const method of ['POST', 'PUT', 'DELETE']) {
    await assert.rejects(handleFinanceRoute({ method }, {}, new URL('http://localhost/api/accounts?view=family'), {
      getUserId: async () => 7,
      readJson: () => assert.fail('Must not read'),
      sendJson: () => assert.fail('Must not succeed'),
    }), { statusCode: 403 })
  }
  assert.equal(await handleFinanceRoute({ method: 'GET' }, {}, new URL('http://localhost/api/dashboard?view=family'), {
    getUserId: async () => null,
    sendJson: () => assert.fail('Must not succeed'),
  }), true)
})
