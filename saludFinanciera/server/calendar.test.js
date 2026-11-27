import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pool } from '../../server/db.js'
import { calendarEvents } from './calendar-events.js'
import { getCalendarData } from './calendar.js'
import { createCategory } from './categories.js'
import { handleFinanceRoute } from './routes.js'

const fixtures = () => ({
  accounts: [
    { id: 1, name: 'Crédito', type: 'Tarjeta de crédito', paymentDueDate: '2026-11-20', paymentToAvoidInterest: '100.00' },
    { id: 2, name: 'Débito', type: 'Tarjeta de débito', paymentDueDate: '2026-11-20' },
    { id: 3, name: 'Otro mes', type: 'Tarjeta de crédito', paymentDueDate: '2026-12-20' },
  ],
  subscriptions: [
    { id: 4, name: 'Internet', status: 'activa', frequency: 'Mensual', billingDay: 31, cost: '250.00' },
    { id: 5, name: 'Semanal', status: 'activa', frequency: 'Semanal', billingDay: 1, cost: '30.00' },
    { id: 6, name: 'Cancelada', status: 'cancelada', frequency: 'Mensual', billingDay: 20 },
    { id: 7, name: 'Anual', status: 'activa', frequency: 'Anual', billingDay: 20, cost: '1200.00' },
  ],
  plans: [
    { id: 8, name: 'Viaje', configured: true, completed: false, periodUnit: 'mes', contributionDay: 31, contribution: '200.00', visible: 0 },
    { id: 9, name: 'Semanal', configured: true, completed: false, periodUnit: 'semana', contributionDay: 7, contribution: '50.00' },
    { id: 10, name: 'Completado', configured: true, completed: true, periodUnit: 'mes', contributionDay: 20 },
    { id: 11, name: 'Sin configurar', configured: false, completed: false },
  ],
})

test('calendar markers distinguish credit cards, active subscriptions and pending plans without creating payments', () => {
  const events = calendarEvents('2026-11', fixtures())
  const card = events.filter((item) => item.kind === 'card')
  assert.deepEqual(card, [{
    kind: 'card', date: '2026-11-20', label: 'Crédito', destinationAccountId: 1, amount: '100.00',
  }])
  const plan = events.find((item) => item.planId === 8)
  assert.equal(plan.date, '2026-11-30')
  assert.equal(plan.amount, '200.00')
  assert.equal(events.find((item) => item.subscriptionId === 4).date, '2026-11-30')
  assert.equal(events.find((item) => item.subscriptionId === 7).reference, true)
  assert.equal(events.find((item) => item.subscriptionId === 4).reference, false)
  assert.ok(!events.some((item) => ['Cancelada', 'Completado', 'Sin configurar', 'Débito', 'Otro mes'].includes(item.label)))
})

test('loan markers appear only on the exact commitment date while pending, in both directions', () => {
  const data = { ...fixtures(), loans: [
    { id: 20, name: 'Ana', type: 'me_deben', remaining: '60.00', commitmentDate: '2026-11-19', accountId: 2 },
    { id: 21, name: 'Luis', type: 'debo', remaining: '150.00', commitmentDate: '2026-11-30', accountId: 3 },
    { id: 22, name: 'Liquidado', type: 'debo', remaining: '0.00', commitmentDate: '2026-11-19' },
    { id: 23, name: 'Otro año', type: 'debo', remaining: '100', commitmentDate: '2027-11-19' },
  ] }
  const events = calendarEvents('2026-11', data).filter((event) => event.kind === 'loan')
  assert.deepEqual(events, [
    { kind: 'loan', date: '2026-11-19', label: 'Ana · Me deben', loanId: 20, loanType: 'me_deben', amount: '60.00', destinationAccountId: 2 },
    { kind: 'loan', date: '2026-11-30', label: 'Luis · Yo debo', loanId: 21, loanType: 'debo', amount: '150.00', originAccountId: 3 },
  ])
  assert.equal(calendarEvents('2026-12', data).filter((event) => event.kind === 'loan').length, 0)
})

test('weekly markers repeat only on their weekday and month-end days clamp for leap years', () => {
  const data = fixtures()
  const events = calendarEvents('2026-11', data)
  assert.deepEqual(events.filter((item) => item.subscriptionId === 5).map((item) => item.date),
    ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
  assert.deepEqual(events.filter((item) => item.planId === 9).map((item) => item.date),
    ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29'])
  assert.equal(calendarEvents('2028-02', data).find((item) => item.planId === 8).date, '2028-02-29')
  assert.equal(calendarEvents('2027-02', data).find((item) => item.planId === 8).date, '2027-02-28')
  data.subscriptions.push({ id: 99, status: 'activa', frequency: 'Semanal', billingDay: 8 })
  assert.ok(!calendarEvents('2026-11', data).some((item) => item.subscriptionId === 99))
})

test('calendar API queries all monthly movements for the owner and returns editable relationships and markers', async (t) => {
  const calls = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    calls.push({ sql, params })
    if (sql.includes('COUNT(*) AS count') && sql.includes('GROUP BY DATE')) {
      assert.match(sql, /WHEN m.id_prestamo IS NULL AND \(cat.tipo = 'ingreso'/)
      assert.match(sql, /WHEN m.id_prestamo IS NULL AND \(cat.tipo = 'gasto'/)
      assert.match(sql, /GROUP BY DATE_FORMAT\(m\.fecha, '%Y-%m-%d'\)/)
      assert.doesNotMatch(sql, /GROUP BY DATE\(m\.fecha\)/)
      return [[{ day: '2026-11-18', count: '301', income: '100.50', expenses: '50.25' }]]
    }
    if (sql.includes('SELECT cat.nombre')) return [[{ name: 'Comida', type: 'gasto', total: '50.25', count: '2' }]]
    if (sql.includes('SELECT m.id')) {
      assert.match(sql, /m\.id_plan_futuro AS planId/)
      assert.match(sql, /m\.id_suscripcion AS subscriptionId/)
      assert.match(sql, /m\.id_cuenta_origen AS originAccountId/)
      assert.match(sql, /m\.id_categoria AS categoryId/)
      return [Array.from({ length: 301 }, (_, index) => ({
        id: index + 1, amount: '1.00', date: '2026-11-18', originAccountId: 2, planId: 8,
      }))]
    }
    if (sql.includes('FROM cuenta')) return [fixtures().accounts]
    if (sql.includes('FROM suscripciones AS s')) return [[]]
    if (sql.includes('FROM plan_futuro AS p')) return [[]]
    if (sql.includes('FROM prestamo p')) return [[]]
    assert.fail(sql)
  })
  const data = await getCalendarData(7, '2026-11')
  assert.equal(data.month, '2026-11')
  assert.equal(data.movements.length, 301)
  assert.equal(data.movements[0].amount, 1)
  assert.equal(data.days[0].count, 301)
  assert.equal(data.days[0].income, 100.5)
  assert.equal(data.categories[0].total, 50.25)
  assert.equal(data.events[0].kind, 'card')
  for (const { sql, params } of calls.slice(0, 3)) {
    assert.match(sql, /m\.id_usuario(?:_destino)? = \?\)? AND m\.fecha >= \? AND m\.fecha < \?/)
    assert.deepEqual(params, sql.includes('id_usuario_destino')
      ? [7, 7, '2026-11-01', '2026-12-01'] : [7, '2026-11-01', '2026-12-01'])
    assert.doesNotMatch(sql, /LIMIT/)
  }
  assert.deepEqual(calls[3].params, [7])
  assert.deepEqual(calls.at(-1).params, [7, 7])
})

test('calendar rejects malformed or unsupported months before querying and propagates database errors', async (t) => {
  let queried = false
  t.mock.method(pool, 'execute', async () => { queried = true; throw new Error('database unavailable') })
  for (const month of ['', '2026-1', '2026-00', '2026-13', '0999-01', '9999-12']) {
    await assert.rejects(getCalendarData(7, month), { statusCode: 400 })
  }
  assert.equal(queried, false)
  await assert.rejects(getCalendarData(7, '2026-12'), /database unavailable/)
})

test('categories validate fields, use the existing nullable savings relation and do not invent an owner column', async (t) => {
  const calls = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    calls.push({ sql, params })
    return sql.startsWith('SELECT') ? [[]] : [{ insertId: 22 }]
  })
  assert.deepEqual(await createCategory({ name: '  Comida  ', type: 'gasto', id_ahorros: 99, id_usuario: 99 }), {
    category: { id: 22, name: 'Comida', type: 'gasto' },
  })
  assert.match(calls[1].sql, /INSERT INTO categorias \(id_ahorros, nombre, tipo\) VALUES \(NULL, \?, \?\)/)
  assert.deepEqual(calls[1].params, ['Comida', 'gasto'])
  assert.doesNotMatch(calls[1].sql, /id_usuario/)
  const count = calls.length
  for (const input of [{ name: '', type: 'gasto' }, { name: 'a'.repeat(101), type: 'gasto' }, { name: 'Test', type: 'transferencia' }]) {
    await assert.rejects(createCategory(input), { statusCode: 400 })
  }
  assert.equal(calls.length, count)
})

test('duplicate categories are rejected and writes require an authenticated route', async (t) => {
  t.mock.method(pool, 'execute', async () => [[{ id: 2 }]])
  await assert.rejects(createCategory({ name: 'Comida', type: 'gasto' }), { statusCode: 409 })
  let read = false
  assert.equal(await handleFinanceRoute({ method: 'POST' }, {}, new URL('http://localhost/api/categories'), {
    getUserId: async () => null,
    readJson: async () => { read = true },
    sendJson: () => assert.fail('Must not claim category creation without authentication'),
  }), true)
  assert.equal(read, false)
})
