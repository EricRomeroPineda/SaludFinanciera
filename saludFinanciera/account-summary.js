import { isCashAccount, isCreditAccount, isDebitAccount } from './account-types.js'

export function cardPaymentStatus(account, today = new Date()) {
  const date = String(account.paymentDueDate || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || account.paymentToAvoidInterest == null) return null
  const [year, month, day] = date.split('-').map(Number)
  const required = Math.round(Number(account.paymentToAvoidInterest) * 100)
  const manual = account.confirmedPaymentDueDate === date
    && account.confirmedPaymentAmount != null
    && Math.round(Number(account.confirmedPaymentAmount) * 100) === required
  const paid = Math.max(0, Math.round(Number(account.paymentTransfers || 0) * 100))
  const remaining = manual ? 0 : Math.max(0, required - paid)
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const budgetDate = new Date(year, month - 1 - (day <= 14 ? 1 : 0), 1)
  const budgetMonth = `${budgetDate.getFullYear()}-${String(budgetDate.getMonth() + 1).padStart(2, '0')}`
  const days = Math.round((Date.UTC(year, month - 1, day)
    - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000)
  return {
    required: required / 100, paid: paid / 100, remaining: remaining / 100, manual, days,
    budgetMonth,
    period: remaining > 0 && budgetMonth < currentMonth ? currentMonth : budgetMonth,
    overdue: remaining > 0 && days < 0,
    urgent: remaining > 0 && days >= 0 && days <= 2,
  }
}

export function calculateAccountSummary(accounts, period, scope = 'month', today = new Date()) {
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
    const status = cardPaymentStatus(account, today)
    const prefix = scope === 'year' ? period.slice(0, 4) : period
    if (status && status.period.startsWith(prefix)) {
      payment += Math.round(status.remaining * 100)
    }

  }
  return {
    available: cash / 100, availableWithCredit: (cash + credit) / 100,
    debt: debt / 100, payment: payment / 100, missingLimits, missingPayments,
  }
}

export function calculatePeriodActivity(months, period, scope = 'month') {
  const prefix = scope === 'year' ? period.slice(0, 4) : period
  const totals = months.filter((row) => row.month.startsWith(prefix)).reduce((sum, row) => ({
    income: sum.income + Math.round(Number(row.income) * 100),
    expenses: sum.expenses + Math.round(Number(row.expenses) * 100),
    investment: sum.investment + Math.round(Number(row.investment || 0) * 100),
  }), { income: 0, expenses: 0, investment: 0 })
  return { income: totals.income / 100, expenses: totals.expenses / 100, investment: totals.investment / 100 }
}
