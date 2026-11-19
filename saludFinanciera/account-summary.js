import { isCashAccount, isCreditAccount, isDebitAccount } from './account-types.js'

export function calculateAccountSummary(accounts, period, scope = 'month') {
  let cash = 0
  let credit = 0
  let debt = 0
  let payment = 0
  let missingLimits = 0
  let missingPayments = 0
  for (const account of accounts) {
    const available = Math.round(Number(account.available || 0) * 100)
    if (isDebitAccount(account.type) || isCashAccount(account.type)) cash += available
    if (!isCreditAccount(account.type)) continue
    credit += available
    if (account.total == null) missingLimits++
    else debt += Math.max(0, Math.round(Number(account.total) * 100) - available)
    if (!account.paymentDueDate || account.paymentToAvoidInterest == null) {
      missingPayments++
      continue
    }
    const prefix = scope === 'year' ? period.slice(0, 4) : period
    if (account.paymentDueDate.slice(0, prefix.length) === prefix) {
      payment += Math.round(Number(account.paymentToAvoidInterest) * 100)
    }
  }
  return {
    available: cash / 100, availableWithCredit: (cash + credit) / 100,
    debt: debt / 100, payment: payment / 100, missingLimits, missingPayments,
  }
}
