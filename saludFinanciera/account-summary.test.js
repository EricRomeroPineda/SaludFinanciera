import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateAccountSummary, calculatePeriodActivity, cardPaymentStatus } from './account-summary.js'

const today = new Date(2026, 10, 1)
const summary = (accounts, period, scope = 'month') => calculateAccountSummary(accounts, period, scope, today)

const accounts = [
  { type: 'Tarjeta de débito', available: '100.10' },
  { type: 'Efectivo', available: '20.20' },
  { type: 'Tarjeta de crédito', available: '200', total: '1000', paymentToAvoidInterest: '100.10', paymentDueDate: '2026-11-30' },
  { type: 'Tarjeta de crédito', available: '400', total: '500', paymentToAvoidInterest: '20.20', paymentDueDate: '2026-12-15' },
  { type: 'Tarjeta de crédito', available: '100', total: '100', paymentToAvoidInterest: '80', paymentDueDate: '2027-11-15' },
]

test('overview separates owned funds, combined availability, debt and selected monthly payments', () => {
  assert.deepEqual(summary(accounts, '2026-11'), {
    available: 120.3, availableWithCredit: 820.3, debt: 900, payment: 100.1,
    missingLimits: 0, missingPayments: 0,
  })
  assert.equal(summary(accounts, '2026-12').payment, 20.2)
  assert.equal(summary(accounts, '2027-11').payment, 80)
  assert.equal(summary(accounts, '2026-01').payment, 0)
})

test('annual payments include all months of the selected year, not matching months in other years', () => {
  assert.equal(summary(accounts, '2026-11', 'year').payment, 120.3)
  assert.equal(summary(accounts, '2027-11', 'year').payment, 80)
})

test('legacy credit fields are flagged, excess available is not negative debt, and debit has no credit payments', () => {
  const result = summary([
    { type: 'Crédito', available: '50', total: null },
    { type: 'Crédito', available: '150', total: '100', paymentDueDate: '2026-11-18', paymentToAvoidInterest: '0' },
    { type: 'Débito', available: '10', paymentDueDate: '2026-11-18', paymentToAvoidInterest: '1000' },
  ], '2026-11')
  assert.deepEqual(result, {
    available: 10, availableWithCredit: 210, debt: 0, payment: 0,
    missingLimits: 1, missingPayments: 1,
  })
})

test('days 1 through 14 belong to the previous budget month, including January and leap years', () => {
  for (const [due, month] of [
    ['2027-01-01', '2026-12'], ['2027-01-03', '2026-12'], ['2027-01-10', '2026-12'],
    ['2027-01-14', '2026-12'], ['2027-01-15', '2027-01'], ['2028-03-14', '2028-02'],
  ]) {
    const account = { type: 'Crédito', paymentDueDate: due, paymentToAvoidInterest: '100' }
    const status = cardPaymentStatus(account, new Date(2026, 11, 30))
    assert.equal(status.budgetMonth, month)
    assert.equal(status.period, month)
    assert.equal(calculateAccountSummary([account], month, 'month', new Date(2026, 11, 30)).payment, 100)
  }
})

test('pending balances carry to the current month, warn near the deadline and remain overdue until covered', () => {
  const account = { paymentDueDate: '2027-01-10', paymentToAvoidInterest: '100.30', paymentTransfers: '20.10' }
  for (const [now, month, urgent, overdue] of [
    [new Date(2026, 11, 30), '2026-12', false, false],
    [new Date(2027, 0, 1), '2027-01', false, false],
    [new Date(2027, 0, 8), '2027-01', true, false],
    [new Date(2027, 0, 10), '2027-01', true, false],
    [new Date(2027, 0, 11), '2027-01', false, true],
    [new Date(2027, 2, 1), '2027-03', false, true],
  ]) {
    const status = cardPaymentStatus(account, now)
    assert.equal(status.period, month)
    assert.equal(status.remaining, 80.2)
    assert.equal(status.urgent, urgent)
    assert.equal(status.overdue, overdue)
  }
  const paid = cardPaymentStatus({ ...account, paymentTransfers: '100.30' }, new Date(2027, 0, 11))
  assert.equal(paid.remaining, 0)
  assert.equal(paid.overdue, false)
  assert.equal(paid.period, '2026-12')
})

test('partial, early and excess transfers reduce the requirement, and manual confirmation belongs only to its due date and amount', () => {
  const account = { paymentDueDate: '2026-12-10', paymentToAvoidInterest: '100.30',
    confirmedPaymentDueDate: '2026-12-10', confirmedPaymentAmount: '100.30', paymentTransfers: '20' }
  assert.equal(cardPaymentStatus(account, today).remaining, 0)
  assert.equal(cardPaymentStatus(account, today).manual, true)
  assert.equal(cardPaymentStatus({ ...account, paymentToAvoidInterest: '200' }, today).remaining, 180)
  assert.equal(cardPaymentStatus({ ...account, paymentDueDate: '2027-01-10' }, today).remaining, 80.3)
  assert.equal(cardPaymentStatus({ ...account, confirmedPaymentDueDate: null }, today).remaining, 80.3)
  assert.equal(cardPaymentStatus({ ...account, paymentTransfers: '500' }, today).remaining, 0)
  assert.equal(cardPaymentStatus({ paymentDueDate: null }, today), null)
})

test('period activity sums exact cents for the selected month/year and never takes totals from the recent list', () => {
  const activity = [
    { month: '2026-11', income: '100.10', expenses: '50.20', investment: '12.30' },
    { month: '2026-12', income: '0.20', expenses: '0.10', investment: '0.20' },
    { month: '2027-11', income: '999', expenses: '888', investment: '999' },
  ]
  assert.deepEqual(calculatePeriodActivity(activity, '2026-11'), { income: 100.1, expenses: 50.2, investment: 12.3 })
  assert.deepEqual(calculatePeriodActivity(activity, '2026-11', 'year'), { income: 100.3, expenses: 50.3, investment: 12.5 })
  assert.deepEqual(calculatePeriodActivity(activity, '2026-01'), { income: 0, expenses: 0, investment: 0 })
})
