import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateAccountSummary } from './account-summary.js'

const accounts = [
  { type: 'Tarjeta de débito', available: '100.10' },
  { type: 'Efectivo', available: '20.20' },
  { type: 'Tarjeta de crédito', available: '200', total: '1000', paymentToAvoidInterest: '100.10', paymentDueDate: '2026-11-30' },
  { type: 'Tarjeta de crédito', available: '400', total: '500', paymentToAvoidInterest: '20.20', paymentDueDate: '2026-12-01' },
  { type: 'Tarjeta de crédito', available: '100', total: '100', paymentToAvoidInterest: '80', paymentDueDate: '2027-11-01' },
]

test('overview separates owned funds, combined availability, debt and selected monthly payments', () => {
  assert.deepEqual(calculateAccountSummary(accounts, '2026-11'), {
    available: 120.3, availableWithCredit: 820.3, debt: 900, payment: 100.1,
    missingLimits: 0, missingPayments: 0,
  })
  assert.equal(calculateAccountSummary(accounts, '2026-12').payment, 20.2)
  assert.equal(calculateAccountSummary(accounts, '2027-11').payment, 80)
  assert.equal(calculateAccountSummary(accounts, '2026-01').payment, 0)
})

test('annual payments include all months of the selected year, not matching months in other years', () => {
  assert.equal(calculateAccountSummary(accounts, '2026-11', 'year').payment, 120.3)
  assert.equal(calculateAccountSummary(accounts, '2027-11', 'year').payment, 80)
})

test('legacy credit fields are flagged, excess available is not negative debt, and debit has no credit payments', () => {
  const result = calculateAccountSummary([
    { type: 'Crédito', available: '50', total: null },
    { type: 'Crédito', available: '150', total: '100', paymentDueDate: '2026-11-18', paymentToAvoidInterest: '0' },
    { type: 'Débito', available: '10', paymentDueDate: '2026-11-18', paymentToAvoidInterest: '1000' },
  ], '2026-11')
  assert.deepEqual(result, {
    available: 10, availableWithCredit: 210, debt: 0, payment: 0,
    missingLimits: 1, missingPayments: 1,
  })
})
