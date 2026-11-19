import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculatePlanProjection, parsePlanDate } from './plan-calculations.js'

const monthly = {
  goal: '300.00', saved: '0.00', contribution: '100.00', periodUnit: 'mes',
  firstContributionDate: '2026-11-18', lastContributionDate: null,
}
const localDate = (text) => new Date(`${text}T12:00:00`)
const project = (changes, date) => calculatePlanProjection({ ...monthly, ...changes }, localDate(date))

test('monthly plan uses the fixed goal and rolls forward for missed or insufficient contributions', () => {
  assert.deepEqual(project({}, '2026-11-18'), {
    configured: true, completed: false, periodsRemaining: 3,
    nextContributionDate: '2026-11-18', estimatedCompletionDate: '2027-01-18',
  })
  assert.equal(project({}, '2026-11-19').estimatedCompletionDate, '2027-02-18')
  assert.equal(project({}, '2026-12-19').estimatedCompletionDate, '2027-03-18')
  const partial = { saved: '50.00', lastContributionDate: '2026-11-18' }
  assert.equal(project(partial, '2026-11-18').periodsRemaining, 3)
  assert.equal(project(partial, '2026-11-18').estimatedCompletionDate, '2027-02-18')
  assert.equal(project(partial, '2026-11-19').estimatedCompletionDate, '2027-02-18')
  assert.equal(monthly.goal, '300.00')
})

test('on-time, late, and advance payments are not counted twice on a due date', () => {
  assert.equal(project({ saved: '100', lastContributionDate: '2026-11-18' }, '2026-11-18')
    .estimatedCompletionDate, '2027-01-18')
  const late = project({ saved: '100', lastContributionDate: '2026-12-18' }, '2026-12-18')
  assert.equal(late.nextContributionDate, '2027-01-18')
  assert.equal(late.estimatedCompletionDate, '2027-02-18')
  const advance = project({ saved: '200', lastContributionDate: '2026-11-18' }, '2026-11-18')
  assert.equal(advance.nextContributionDate, '2027-01-18')
  assert.equal(advance.estimatedCompletionDate, '2027-01-18')
})

test('weekly schedules use seven-day periods rather than calendar months', () => {
  const weekly = { periodUnit: 'semana' }
  assert.equal(project(weekly, '2026-11-18').estimatedCompletionDate, '2026-12-02')
  assert.equal(project(weekly, '2026-11-19').estimatedCompletionDate, '2026-12-09')
  assert.equal(project({ ...weekly, saved: '100', lastContributionDate: '2026-11-18' }, '2026-11-18')
    .estimatedCompletionDate, '2026-12-02')
  assert.equal(project({ ...weekly, saved: '50', lastContributionDate: '2026-11-18' }, '2026-11-19')
    .periodsRemaining, 3)
})

test('month-end schedules clamp short months without losing the original day', () => {
  const plan = { firstContributionDate: '2027-01-31' }
  assert.equal(project(plan, '2027-01-31').estimatedCompletionDate, '2027-03-31')
  assert.equal(project(plan, '2027-02-28').nextContributionDate, '2027-02-28')
  assert.equal(project(plan, '2027-03-01').nextContributionDate, '2027-03-31')
  assert.equal(project({ firstContributionDate: '2028-01-31' }, '2028-02-29')
    .nextContributionDate, '2028-02-29')
})

test('cent amounts, final partial installments, completion and overfunding', () => {
  assert.equal(project({ goal: '0.30', saved: '0.10', contribution: '0.10' }, '2026-11-18')
    .periodsRemaining, 2)
  assert.equal(project({ goal: '250', saved: '100' }, '2026-11-19').periodsRemaining, 2)
  for (const saved of ['300', '350']) {
    assert.deepEqual(project({ saved }, '2026-12-19'), {
      configured: true, completed: true, periodsRemaining: 0,
      nextContributionDate: null, estimatedCompletionDate: null,
    })
  }
})

test('legacy plans require configuration and dates beyond the supported range are explicit', () => {
  for (const changes of [
    { contribution: null }, { contribution: '0' }, { firstContributionDate: null },
    { periodUnit: 'anio' }, { periodUnit: null },
  ]) {
    assert.equal(project(changes, '2026-11-18').configured, false)
    assert.equal(project(changes, '2026-11-18').periodsRemaining, null)
  }
  assert.equal(project({ firstContributionDate: '9999-12-31' }, '2026-11-18')
    .estimatedCompletionDate, null)
  assert.equal(project({ goal: '9999999999999.99', contribution: '0.01' }, '2026-11-18')
    .estimatedCompletionDate, null)
})

test('only real ISO calendar dates in the database range are accepted', () => {
  for (const value of ['2026-02-29', '2026-13-01', '2026-04-31', '01/01/2026', '', null, '0999-01-01']) {
    assert.equal(parsePlanDate(value), null)
  }
  for (const value of ['2028-02-29', '2026-11-18', '9999-12-31']) {
    assert.equal(parsePlanDate(value).toISOString().slice(0, 10), value)
  }
})
