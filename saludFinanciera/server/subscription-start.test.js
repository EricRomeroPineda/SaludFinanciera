import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pool } from '../../server/db.js'
import { createSubscription, updateSubscription, getSubscriptions } from '../suscripciones/service.js'

const input = { name: 'Internet', cost: '100.00', frequency: 'Mensual', type: 'servicio',
  billingDay: 18, paymentType: 'manual', status: 'activa', startDate: '2026-11-18' }

for (const edit of [false, true]) {
  test(`subscription ${edit ? 'update' : 'create'} persists and returns its real start date`, async (t) => {
    const calls = []
    t.mock.method(pool, 'execute', async (sql, params) => {
      calls.push({ sql, params })
      if (sql.trim().startsWith('SELECT')) return [[{ id: 5, ...input, startDate: '2026-11-18' }]]
      return [{ affectedRows: 1, insertId: 5 }]
    })
    const result = edit ? await updateSubscription(7, 5, input) : await createSubscription(7, input)
    assert.equal(result.subscription.startDate, '2026-11-18')
    assert.match(calls[0].sql, /fecha_inicio/)
    assert.equal(calls[0].params[edit ? 8 : 9], '2026-11-18')
    assert.match(calls[1].sql, /DATE_FORMAT\(s\.fecha_inicio, '%Y-%m-%d'\) AS startDate/)
    assert.deepEqual(calls[1].params, [7, 5])
  })
}

test('subscription start validation rejects absent and impossible dates without writes', async (t) => {
  t.mock.method(pool, 'execute', () => assert.fail('Invalid date reached SQL'))
  for (const startDate of [null, undefined, '', '2026-02-29', '2026-04-31']) {
    await assert.rejects(createSubscription(7, { ...input, startDate }), { statusCode: 400 })
    await assert.rejects(updateSubscription(7, 5, { ...input, startDate }), { statusCode: 400 })
  }
})

test('legacy NULL subscription start is returned without inventing a historical date', async (t) => {
  t.mock.method(pool, 'execute', async () => [[{ id: 5, ...input, startDate: null }]])
  assert.equal((await getSubscriptions(7))[0].startDate, null)
})
