import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pool } from '../../server/db.js'
import { createAccount, deleteAccount, updateAccount } from './dashboard.js'

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
