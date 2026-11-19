import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculatePlanProjection } from './plan-calculations.js'

const plan = { goal: '1000.00', saved: '50.00', periodUnit: 'mes', contribution: '200.00', contributionDay: 18 }
const project = (changes = {}, date = new Date(2026, 10, 18, 12)) =>
  calculatePlanProjection({ ...plan, ...changes }, date)

test('periods are calculated from the pending balance, rounding up for a final partial payment', () => {
  assert.deepEqual(project(), {
    configured: true, completed: false, periodsRemaining: 5,
    nextContributionDate: '2026-11-18', estimatedCompletionDate: '2027-03-18',
  })
  assert.equal(project({ saved: '200' }).periodsRemaining, 4)
  assert.equal(project({ saved: '250' }).periodsRemaining, 4)
  assert.equal(project({ goal: '0.30', saved: '0.10', contribution: '0.10' }).periodsRemaining, 2)
  assert.equal(project({ periodsRemaining: 999 }).periodsRemaining, 5)
  assert.equal(plan.goal, '1000.00')
})

test('missing a scheduled day shifts the estimate to the next monthly contribution', () => {
  assert.equal(project({}, new Date(2026, 10, 19)).nextContributionDate, '2026-12-18')
  assert.equal(project({}, new Date(2026, 10, 19)).estimatedCompletionDate, '2027-04-18')
  assert.equal(project({}, new Date(2026, 11, 19)).estimatedCompletionDate, '2027-05-18')
})

test('a contribution today consumes the date; partial or insufficient amounts require another period', () => {
  assert.equal(project({ lastContributionDate: '2026-11-18' }).estimatedCompletionDate, '2027-04-18')
  assert.equal(project({ saved: '200', lastContributionDate: '2026-11-18' }).estimatedCompletionDate, '2027-03-18')
  assert.equal(project({ saved: '400', lastContributionDate: '2026-11-18' }).estimatedCompletionDate, '2027-02-18')
  assert.equal(project({ lastContributionDate: '2026-11-01' }).nextContributionDate, '2026-11-18')
})

test('weekly plans use Monday through Sunday and seven-day intervals', () => {
  const weekly = { periodUnit: 'semana', contributionDay: 3 }
  assert.equal(project(weekly).nextContributionDate, '2026-11-18')
  assert.equal(project(weekly).estimatedCompletionDate, '2026-12-16')
  assert.equal(project(weekly, new Date(2026, 10, 19)).estimatedCompletionDate, '2026-12-23')
  assert.equal(project({ ...weekly, contributionDay: 1 }).nextContributionDate, '2026-11-23')
  assert.equal(project({ ...weekly, contributionDay: 7 }).nextContributionDate, '2026-11-22')
  assert.equal(project({ ...weekly, lastContributionDate: '2026-11-18' }).nextContributionDate, '2026-11-25')
})

test('monthly dates clamp short months without losing the configured day', () => {
  const changes = { contributionDay: 31, goal: '600', saved: '0' }
  assert.equal(project(changes, new Date(2027, 0, 31)).estimatedCompletionDate, '2027-03-31')
  assert.equal(project(changes, new Date(2027, 1, 28)).nextContributionDate, '2027-02-28')
  assert.equal(project(changes, new Date(2028, 1, 28)).nextContributionDate, '2028-02-29')
  assert.equal(project({ ...changes, lastContributionDate: '2027-02-28' }, new Date(2027, 1, 28))
    .nextContributionDate, '2027-03-31')
})

test('completed and overfunded plans have zero remaining periods and no future contributions', () => {
  for (const saved of ['1000', '1200']) {
    assert.deepEqual(project({ saved }), {
      configured: true, completed: true, periodsRemaining: 0,
      nextContributionDate: null, estimatedCompletionDate: null,
    })
  }
})

test('legacy schedules require configuration and dates outside the supported range are explicit', () => {
  for (const changes of [
    { contribution: null }, { contribution: 0 }, { contributionDay: null },
    { contributionDay: 32 }, { periodUnit: 'semana', contributionDay: 8 }, { periodUnit: 'anio' },
  ]) {
    assert.equal(project(changes).configured, false)
    assert.equal(project(changes).periodsRemaining, null)
  }
  assert.equal(project({ contribution: '0.01', goal: '9999999999999.99' }).estimatedCompletionDate, null)
})
