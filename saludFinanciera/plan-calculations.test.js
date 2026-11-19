import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculatePlanProjection } from './plan-calculations.js'

const plan = { goal: '300.00', saved: '100.00', periodUnit: 'mes', periodsRemaining: 3 }
const project = (changes = {}, date = new Date(2026, 10, 18, 12)) =>
  calculatePlanProjection({ ...plan, ...changes }, date)

test('manual periods project full weeks, months and years from today', () => {
  assert.equal(project().estimatedCompletionDate, '2027-02-18')
  assert.equal(project({ periodUnit: 'semana' }).estimatedCompletionDate, '2026-12-09')
  assert.equal(project({ periodUnit: 'anio' }).estimatedCompletionDate, '2029-11-18')
  assert.equal(project({ periodsRemaining: 0 }).estimatedCompletionDate, '2026-11-18')
  assert.equal(project({ periodsRemaining: '3' }).estimatedCompletionDate, '2027-02-18')
})

test('estimates move with today but do not detect missed or partial payments', () => {
  assert.equal(project({}, new Date(2026, 10, 19, 12)).estimatedCompletionDate, '2027-02-19')
  for (const saved of ['0', '50', '200']) {
    assert.equal(project({ saved }).estimatedCompletionDate, '2027-02-18')
  }
  assert.equal(plan.periodsRemaining, 3)
  assert.equal(plan.goal, '300.00')
})

test('months and years clamp dates at month end, including leap years', () => {
  assert.equal(project({ periodsRemaining: 1 }, new Date(2027, 0, 31)).estimatedCompletionDate, '2027-02-28')
  assert.equal(project({ periodsRemaining: 1 }, new Date(2028, 0, 31)).estimatedCompletionDate, '2028-02-29')
  assert.equal(project({ periodsRemaining: 2 }, new Date(2027, 0, 31)).estimatedCompletionDate, '2027-03-31')
  assert.equal(project({ periodUnit: 'anio', periodsRemaining: 1 }, new Date(2028, 1, 29))
    .estimatedCompletionDate, '2029-02-28')
})

test('completed and overfunded plans omit estimates without modifying the manual periods', () => {
  for (const saved of ['300', '350']) {
    assert.deepEqual(project({ saved }), { configured: true, completed: true, estimatedCompletionDate: null })
  }
  assert.equal(project({ goal: '0.30', saved: '0.30' }).completed, true)
  assert.equal(plan.periodsRemaining, 3)
})

test('missing or invalid configuration is explicit, zero is valid, excessive dates have no estimate', () => {
  for (const periodsRemaining of [null, undefined, '', ' ', -1, 1.5, 4294967296]) {
    assert.equal(project({ periodsRemaining }).configured, false)
  }
  assert.equal(project({ periodUnit: null }).configured, false)
  assert.equal(project({ periodsRemaining: 0 }).configured, true)
  assert.equal(project({ periodsRemaining: 4294967295 }).estimatedCompletionDate, null)
  assert.equal(project({}, new Date(9999, 11, 31)).estimatedCompletionDate, null)
})
