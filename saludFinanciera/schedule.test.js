import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextScheduledDate, parseScheduleDate } from './schedule.js'
import { calendarEvents } from './server/calendar-events.js'
import { calculatePlanProjection } from './plan-calculations.js'
import { daysUntilBilling } from './suscripciones/calculations.js'

const utc = (date) => new Date(`${date}T00:00:00Z`)
const text = (date) => date?.toISOString().slice(0, 10)
const weekly = { id: 8, name: 'Viaje', goal: '1000', saved: '0', contribution: '200', contributionDay: 1,
  periodUnit: 'semana', startDate: '2026-11-18', configured: true, completed: false }

test('weekly schedules begin on or after the real start and include a matching start weekday', () => {
  assert.equal(text(nextScheduledDate('semana', 1, utc('2026-11-01'), '2026-11-18')), '2026-11-23')
  assert.equal(text(nextScheduledDate('semanal', 1, utc('2026-11-01'), '2026-11-16')), '2026-11-16')
  const events = calendarEvents('2026-11', { accounts: [], subscriptions: [], plans: [weekly] })
  assert.deepEqual(events.map((event) => event.date), ['2026-11-23', '2026-11-30'])
  assert.deepEqual(calendarEvents('2026-10', { accounts: [], subscriptions: [], plans: [weekly] }), [])
  assert.equal(calendarEvents('2027-01', { accounts: [], subscriptions: [], plans: [weekly] }).length, 4)
})

test('plan projection waits for future start and rolls forward while money remains', () => {
  const before = calculatePlanProjection(weekly, new Date(2026, 10, 1))
  assert.equal(before.nextContributionDate, '2026-11-23')
  assert.equal(before.estimatedCompletionDate, '2026-12-21')
  const missed = calculatePlanProjection(weekly, new Date(2026, 10, 24))
  assert.equal(missed.estimatedCompletionDate, '2026-12-28')
  assert.equal(calculatePlanProjection({ ...weekly, saved: '200', lastContributionDate: '2026-11-23' },
    new Date(2026, 10, 24)).estimatedCompletionDate, '2026-12-21')
  assert.equal(calculatePlanProjection({ ...weekly, saved: '1000' }).periodsRemaining, 0)
  assert.equal(calculatePlanProjection({ ...weekly, periodUnit: 'mes', contributionDay: 16 },
    new Date(2026, 10, 1)).nextContributionDate, '2026-12-16')
})

test('long subscription frequencies are anchored to their start month rather than repeated every month', () => {
  for (const [frequency, nextMonth] of [['Trimestral', '2027-02'], ['Semestral', '2027-05'], ['Anual', '2027-11']]) {
    const subscription = { id: 5, name: 'Servicio', status: 'activa', frequency,
      billingDay: 20, startDate: '2026-11-18', cost: '100' }
    const events = (month) => calendarEvents(month, { accounts: [], plans: [], subscriptions: [subscription] })
    assert.equal(events('2026-11')[0].date, '2026-11-20')
    assert.equal(events('2026-11')[0].reference, false)
    assert.equal(events('2026-12').length, 0)
    assert.equal(events(nextMonth)[0].date, `${nextMonth}-20`)
    assert.equal(events('2026-10').length, 0)
  }
})

test('monthly starts, leap days and indicator counts share the same schedule', () => {
  assert.equal(text(nextScheduledDate('mensual', 31, utc('2028-02-01'), '2028-02-01')), '2028-02-29')
  assert.equal(text(nextScheduledDate('trimestral', 10, utc('2026-11-01'), '2026-11-18')), '2027-02-10')
  assert.equal(daysUntilBilling('Semanal', 1, new Date(2026, 10, 1), '2026-11-18'), 22)
  assert.equal(daysUntilBilling('Mensual', 18, new Date(2026, 10, 18), '2026-11-18'), 0)
  assert.equal(daysUntilBilling('Trimestral', 20, new Date(2026, 10, 21), '2026-11-18'), 91)
  assert.equal(daysUntilBilling('Trimestral', 20, new Date(2026, 10, 21)), 29)
})

test('legacy NULL starts preserve prior schedules, invalid dates are rejected and range limits are safe', () => {
  assert.equal(text(nextScheduledDate('semanal', 1, utc('2026-11-01'))), '2026-11-02')
  for (const value of ['', '2026-02-29', '2026-04-31', '2026-13-01', '0999-12-31', '01/01/2026']) {
    assert.equal(parseScheduleDate(value), null)
  }
  assert.equal(text(parseScheduleDate('2028-02-29')), '2028-02-29')
  assert.equal(nextScheduledDate('mensual', 31, utc('9999-12-31'), 'invalid'), null)
  assert.equal(nextScheduledDate('mensual', 1, utc('9999-12-31')), null)
})
