import { isCreditAccount } from '../account-types.js'

export function calendarEvents(month, { accounts, subscriptions, plans }) {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const events = []
  const recurring = (kind, item, weekly, day, extra = {}) => {
    day = Number(day)
    if (!Number.isInteger(day) || day < 1 || day > (weekly ? 7 : 31)) return
    const dates = weekly
      ? Array.from({ length: lastDay }, (_, index) => index + 1)
        .filter((date) => (new Date(Date.UTC(year, monthNumber - 1, date)).getUTCDay() || 7) === day)
      : [Math.min(day, lastDay)]
    for (const date of dates) {
      events.push({ kind, date: `${month}-${String(date).padStart(2, '0')}`, label: item.name, ...extra })
    }
  }
  for (const account of accounts) {
    if (!isCreditAccount(account.type) || !account.paymentDueDate?.startsWith(`${month}-`)) continue
    events.push({
      kind: 'card', date: account.paymentDueDate, label: account.name,
      destinationAccountId: account.id, amount: account.paymentToAvoidInterest,
    })
  }
  for (const subscription of subscriptions) {
    if (String(subscription.status).toLowerCase() !== 'activa') continue
    const frequency = String(subscription.frequency).trim().toLowerCase()
    if (!['semanal', 'mensual', 'trimestral', 'semestral', 'anual'].includes(frequency)) continue
    recurring('subscription', subscription, frequency === 'semanal', subscription.billingDay, {
      subscriptionId: subscription.id, amount: subscription.cost,
      reference: !['semanal', 'mensual'].includes(frequency),
    })
  }
  for (const plan of plans) {
    if (!plan.configured || plan.completed) continue
    recurring('plan', plan, plan.periodUnit === 'semana', plan.contributionDay, {
      planId: plan.id, amount: plan.contribution,
    })
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, 'es'))
}
