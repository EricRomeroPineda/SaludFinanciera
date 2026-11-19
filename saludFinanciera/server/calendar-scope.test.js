import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pool } from '../../server/db.js'
import { getCalendarData } from './calendar.js'

for (const scope of ['all', 'year', 'month']) {
  test(`calendar register scope ${scope} preserves owner filtering and includes any category`, async (t) => {
    let queriedMovements = false
    t.mock.method(pool, 'execute', async (sql, params) => {
      if (sql.includes('SELECT m.id')) {
        queriedMovements = true
        assert.match(sql, /LEFT JOIN categorias/)
        assert.doesNotMatch(sql, /LIMIT|cat\.nombre =|cat\.tipo =/)
        if (scope === 'all') {
          assert.match(sql, /WHERE m\.id_usuario = \?\s+ORDER BY m\.fecha DESC/)
          assert.deepEqual(params, [7])
        } else {
          assert.deepEqual(params, scope === 'year'
            ? [7, '2026-01-01', '2027-01-01'] : [7, '2026-11-01', '2026-12-01'])
        }
        return [[{ id: 8, date: '2026-11-16', amount: '100.00', category: 'Inversión', categoryType: 'gasto' }]]
      }
      if (sql.includes('GROUP BY DATE') || sql.includes('SELECT cat.nombre')) {
        assert.deepEqual(params, [7, '2026-11-01', '2026-12-01'])
      }
      return [[]]
    })
    const data = await getCalendarData(7, '2026-11', scope)
    assert.equal(queriedMovements, true)
    assert.equal(data.scope, scope)
    assert.equal(data.movements[0].category, 'Inversión')
    assert.equal(data.movements[0].date, '2026-11-16')
  })
}

test('unsupported scopes fail before querying the database', async (t) => {
  t.mock.method(pool, 'execute', () => assert.fail('Must reject invalid scope'))
  await assert.rejects(getCalendarData(7, '2026-11', 'invalid'), { statusCode: 400 })
})
