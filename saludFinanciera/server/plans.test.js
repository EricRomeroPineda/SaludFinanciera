import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pool } from '../../server/db.js'
import { createPlan, getPlans, lockPlans, syncPlanSavings, updatePlan } from './modules.js'
import { deleteMovement, saveMovement } from './movements.js'

const input = {
  name: 'Vacaciones', goal: '300.00', unitPeriod: 'mes', contribution: '100.00',
  firstContributionDate: '2026-11-18', visible: true,
}

test('creating and editing plans persist the schedule but never accept a manual accumulated amount', async (t) => {
  const calls = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    calls.push({ sql, params })
    return [{ insertId: 8, affectedRows: 1 }]
  })
  assert.deepEqual(await createPlan(7, { ...input, saved: '999', monetizado: '999' }), { id: 8 })
  assert.match(calls[0].sql, /monetizado/)
  assert.match(calls[0].sql, /VALUES \(\?, \?, \?, 0,/)
  assert.deepEqual(calls[0].params, [7, 'Vacaciones', '300.00', true, 'mes', '100.00', '2026-11-18'])
  await updatePlan(7, 8, { ...input, saved: '999', monetizado: '999' })
  assert.doesNotMatch(calls[1].sql, /monetizado\s*=/)
  assert.deepEqual(calls[1].params, ['Vacaciones', '300.00', true, 'mes', '100.00', '2026-11-18', 8, 7])
})

test('plan API rejects incomplete schedules, invalid amounts and impossible dates before SQL', async (t) => {
  const execute = t.mock.method(pool, 'execute', () => assert.fail('Invalid input must not reach SQL'))
  for (const changes of [
    { goal: 0 }, { contribution: '' }, { contribution: 0 }, { contribution: '-10' },
    { contribution: '1.001' }, { unitPeriod: 'anio' }, { unitPeriod: null },
    { firstContributionDate: '2026-02-29' }, { firstContributionDate: '' },
  ]) {
    await assert.rejects(createPlan(7, { ...input, ...changes }), { statusCode: 400 })
    await assert.rejects(updatePlan(7, 8, { ...input, ...changes }), { statusCode: 400 })
  }
  assert.equal(execute.mock.callCount(), 0)
})

test('editing a nonexistent or foreign plan returns 404', async (t) => {
  t.mock.method(pool, 'execute', async () => [{ affectedRows: 0 }])
  await assert.rejects(updatePlan(7, 8, input), { statusCode: 404 })
})

test('plan reads aggregate all movements for the owner and calculate the remaining amount and schedule', async (t) => {
  t.mock.method(pool, 'execute', async (sql, params) => {
    assert.match(sql, /SUM\(monto\) AS saved/)
    assert.match(sql, /MAX\(fecha\) AS lastContributionDate/)
    assert.match(sql, /p\.meta - COALESCE\(t\.saved, 0\) AS remaining/)
    assert.match(sql, /t\.id_usuario = p\.id_usuario/)
    assert.doesNotMatch(sql, /LIMIT|p\.monetizado AS saved/)
    assert.deepEqual(params, [7, 7])
    return [[{
      id: 8, goal: '300.00', saved: '100.00', remaining: '200.00',
      contribution: '100.00', periodUnit: 'mes', firstContributionDate: '9998-11-18',
    }]]
  })
  const [plan] = await getPlans(7)
  assert.equal(plan.saved, '100.00')
  assert.equal(plan.remaining, '200.00')
  assert.equal(plan.periodsRemaining, 2)
})

test('plan locks and synchronization use unique sorted IDs and user-scoped sums', async () => {
  const calls = []
  const connection = { execute: async (sql, params) => {
    calls.push({ sql, params })
    return [sql.startsWith('SELECT') ? [{ id: 8 }, { id: 9 }] : { affectedRows: 1 }]
  } }
  await lockPlans(connection, 7, [9, 8, null, 9])
  assert.deepEqual(calls[0].params, [7, 8, 9])
  assert.match(calls[0].sql, /ORDER BY id FOR UPDATE/)
  await syncPlanSavings(connection, 7, [9, 8, null, 9])
  assert.deepEqual(calls.slice(1).map((call) => call.params), [[8, 7], [9, 7]])
  for (const { sql } of calls.slice(1)) {
    assert.match(sql, /SUM\(m\.monto\)/)
    assert.match(sql, /m\.id_usuario = p\.id_usuario/)
    assert.match(sql, /WHERE p\.id = \? AND p\.id_usuario = \?/)
  }
  await assert.rejects(lockPlans({ execute: async () => [[]] }, 7, [8]), { statusCode: 404 })
})

function mockMovementConnection(t, { oldPlanId = null, failSync = false } = {}) {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push({ sql: 'BEGIN' }) },
    async commit() { calls.push({ sql: 'COMMIT' }) },
    async rollback() { calls.push({ sql: 'ROLLBACK' }) },
    release() { calls.push({ sql: 'RELEASE' }) },
    async execute(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM movimiento WHERE id =')) {
        return [[{ id: 15, id_plan_futuro: oldPlanId, id_suscripcion: null,
          id_cuenta_origen: 2, id_cuenta_destino: null, monto: '50.00' }]]
      }
      if (sql.includes('FROM plan_futuro WHERE id_usuario')) {
        return [params.slice(1).map((id) => ({ id }))]
      }
      if (sql.includes('SELECT id FROM plan_futuro')) return [[{ id: params[0] }]]
      if (sql.includes('SELECT id, disponible FROM cuenta')) return [[{ id: 2, disponible: '1000.00' }]]
      if (failSync && sql.includes('SET monetizado =')) throw new Error('sync failed')
      return [{ affectedRows: 1, insertId: 15 }]
    },
  }
  t.mock.method(pool, 'getConnection', async () => connection)
  return calls
}

const movement = { operation: 'expense', amount: '100', date: '2026-11-18', originAccountId: 2, planId: 9 }

for (const [label, oldPlanId, newPlanId] of [
  ['create', null, 9], ['edit in same plan', 9, 9], ['reassign', 8, 9],
  ['remove association', 8, null],
]) {
  test(`movement ${label} synchronizes the affected plans after writing and before commit`, async (t) => {
    const calls = mockMovementConnection(t, { oldPlanId })
    const result = await saveMovement(7, { ...movement, planId: newPlanId }, label === 'create' ? null : 15)
    assert.equal(result.id, 15)
    const mutation = calls.findIndex(({ sql }) => /(?:INSERT INTO|UPDATE) movimiento/.test(sql))
    const syncs = calls.flatMap((call, index) => call.sql.includes('SET monetizado =') ? [{ ...call, index }] : [])
    const expectedIds = [...new Set([oldPlanId, newPlanId].filter(Boolean))].sort()
    assert.deepEqual(syncs.map(({ params }) => params), expectedIds.map((id) => [id, 7]))
    for (const { index, sql } of syncs) {
      assert.ok(index > mutation)
      assert.ok(index < calls.findIndex((call) => call.sql === 'COMMIT'))
      assert.match(sql, /SUM\(m\.monto\)/)
    }
    assert.equal(calls.at(-1).sql, 'RELEASE')
    assert.ok(!calls.some(({ sql }) => /monetizado = monetizado [+-]/.test(sql)))
  })
}

test('deleting a movement recalculates its old plan even with an outdated accumulated balance', async (t) => {
  const calls = mockMovementConnection(t, { oldPlanId: 8 })
  await deleteMovement(7, 15)
  const deletion = calls.findIndex(({ sql }) => sql.startsWith('DELETE FROM movimiento'))
  const sync = calls.findIndex(({ sql }) => sql.includes('SET monetizado ='))
  assert.ok(sync > deletion)
  assert.deepEqual(calls[sync].params, [8, 7])
  assert.equal(calls.at(-2).sql, 'COMMIT')
})

test('failed plan synchronization rolls back account and movement writes', async (t) => {
  const calls = mockMovementConnection(t, { failSync: true })
  await assert.rejects(saveMovement(7, movement), /sync failed/)
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'))
  assert.ok(!calls.some(({ sql }) => sql === 'COMMIT'))
  assert.equal(calls.at(-1).sql, 'RELEASE')
})
