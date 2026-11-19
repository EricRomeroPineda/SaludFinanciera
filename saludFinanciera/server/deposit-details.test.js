import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pool } from '../../server/db.js'
import { depositDetails } from './validation.js'
import { createAccount, updateAccount } from './dashboard.js'
import { createPlan, updatePlan } from './modules.js'
import { createLoan, updateLoan } from './loans.js'
import { createSubscription, updateSubscription } from '../suscripciones/service.js'
import { calendarEvents } from './calendar-events.js'
import { getCalendarData } from './calendar.js'

const deposit = 'Banco de prueba, Ana, CLABE 001234567890123456, referencia 001'
const plan = { name: 'Meta', goal: '100', contribution: '10', unitPeriod: 'mes', contributionDay: 20, startDate: '2026-11-01' }
const subscription = { name: 'Servicio', cost: '100', frequency: 'Mensual', type: 'servicio', billingDay: 20, startDate: '2026-11-01' }
const loan = { name: 'Ana', principal: '100', type: 'debo', startDate: '2026-11-01',
  commitmentDate: '2026-11-20', recordDisbursement: false }

test('deposit information is optional text, preserves leading zeros and rejects invalid input', () => {
  for (const empty of [null, undefined, '', '  ']) assert.equal(depositDetails(empty), null)
  assert.equal(depositDetails(` ${deposit} `), deposit)
  assert.equal(depositDetails('001234'), '001234')
  assert.equal(depositDetails('x'.repeat(500)), 'x'.repeat(500))
  for (const invalid of ['x'.repeat(501), {}, 123, 'foo\u0000bar', 'foo\nbar']) {
    assert.throws(() => depositDetails(invalid), { statusCode: 400 })
  }
})

test('create/update persist independent optional deposit data for accounts, plans and subscriptions with owner-scoped writes', async (t) => {
  const writes = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    assert.equal((sql.match(/\?/g) || []).length, params.length, sql)
    if (sql.trim().startsWith('SELECT')) {
      assert.match(sql, /s.datos_deposito AS depositDetails/)
      return [[{ id: 8, ...subscription, depositDetails: deposit }]]
    }
    writes.push({ sql, params })
    return [{ insertId: 8, affectedRows: 1 }]
  })
  for (const [create, update, input] of [
    [createAccount, updateAccount, { name: 'Banco', type: 'Tarjeta de débito', available: '100' }],
    [createPlan, updatePlan, plan],
    [createSubscription, updateSubscription, subscription],
  ]) {
    await create(7, { ...input, depositDetails: deposit })
    await update(7, 8, { ...input, depositDetails: deposit })
    const [insert, edit] = writes.slice(-2)
    assert.match(insert.sql, /datos_deposito/)
    assert.equal(insert.params.at(-1), deposit)
    assert.match(edit.sql, /datos_deposito = \?/)
    assert.match(edit.sql, /WHERE id = \? AND id_usuario = \?/)
    assert.deepEqual(edit.params.slice(-3), [deposit, 8, 7])
    await update(7, 8, { ...input, depositDetails: '' })
    assert.equal(writes.at(-1).params.at(-3), null)
  }
})

test('loan deposits belong to the creditor, remain separate from the source account and are omitted for Me deben', async (t) => {
  const writes = []
  let type = 'debo'
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    execute: async (sql, params) => {
      assert.equal((sql.match(/\?/g) || []).length, params.length)
      if (sql.startsWith('SELECT')) return [[{ type, startDate: loan.startDate }]]
      writes.push({ sql, params })
      return [{ insertId: 8, affectedRows: 1 }]
    },
  }))
  await createLoan(7, { ...loan, depositDetails: deposit })
  assert.equal(writes.at(-1).params.at(-1), deposit)
  assert.equal(writes.at(-1).params[6], null, 'No financial account is inferred from creditor deposit information')
  await updateLoan(7, 8, { ...loan, depositDetails: deposit })
  assert.deepEqual(writes.at(-1).params.slice(-3), [deposit, 8, 7])
  type = 'me_deben'
  await createLoan(7, { ...loan, type, depositDetails: deposit })
  assert.equal(writes.at(-1).params.at(-1), null)
  await updateLoan(7, 8, { ...loan, type: 'debo', depositDetails: deposit })
  assert.deepEqual(writes.at(-1).params.slice(-3), [null, 8, 7], 'Persisted type, not supplied type, controls omission')
})

test('calendar reads include deposit columns and propagate only eligible source data into markers', async (t) => {
  t.mock.method(pool, 'execute', async (sql, params) => {
    assert.equal(params[0], 7)
    if (sql.includes('FROM cuenta WHERE')) {
      assert.match(sql, /datos_deposito AS depositDetails/)
      return [[{ id: 1, name: 'Banco', type: 'Tarjeta de crédito', paymentDueDate: '2026-11-20',
        paymentToAvoidInterest: '100', depositDetails: 'Cuenta 001' }]]
    }
    if (sql.includes('FROM suscripciones AS s')) {
      assert.match(sql, /s.datos_deposito AS depositDetails/)
      return [[{ id: 2, ...subscription, status: 'activa', depositDetails: 'Cuenta 002' }]]
    }
    if (sql.includes('FROM plan_futuro AS p')) {
      assert.match(sql, /p.datos_deposito AS depositDetails/)
      return [[{ id: 3, name: 'Meta', goal: '100', saved: '0', remaining: '100', periodUnit: 'mes',
        contribution: '10', contributionDay: 20, startDate: '2026-11-01', depositDetails: 'Cuenta 003' }]]
    }
    if (sql.includes('FROM prestamo p')) {
      assert.match(sql, /CASE WHEN p.tipo = 'debo' THEN p.datos_deposito ELSE NULL END AS depositDetails/)
      return [[{ id: 4, ...loan, remaining: '100', depositDetails: 'Cuenta 004' }]]
    }
    return [[]]
  })
  const { events } = await getCalendarData(7, '2026-11')
  assert.equal(events.find((event) => event.kind === 'card').depositDetails, 'Cuenta 001')
  assert.equal(events.find((event) => event.kind === 'subscription').depositDetails, 'Cuenta 002')
  assert.equal(events.find((event) => event.kind === 'plan').depositDetails, 'Cuenta 003')
  assert.equal(events.find((event) => event.kind === 'loan').depositDetails, 'Cuenta 004')
  const receiving = calendarEvents('2026-11', {
    accounts: [], subscriptions: [], plans: [],
    loans: [{ ...loan, id: 5, type: 'me_deben', remaining: '100', depositDetails: deposit }],
  })
  assert.equal(receiving[0].depositDetails, undefined)
})
