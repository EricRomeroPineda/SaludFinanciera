import { isCreditAccount } from '../account-types.js'
import { nextScheduledDate } from '../schedule.js'

export function calendarEvents(month, { accounts, subscriptions, plans }) {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const events = []
  const recurring = (kind, item, frequency, day, extra = {}) => {
    let from = new Date(Date.UTC(year, monthNumber - 1, 1))
    const end = new Date(Date.UTC(year, monthNumber - 1, lastDay))
    let date = nextScheduledDate(frequency, day, from, item.startDate)
    while (date && date <= end) {
      events.push({ kind, date: date.toISOString().slice(0, 10), label: item.name, ...extra })
      from = new Date(date)
      from.setUTCDate(from.getUTCDate() + 1)
      date = nextScheduledDate(frequency, day, from, item.startDate)
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
    const reference = !subscription.startDate && !['semanal', 'mensual'].includes(frequency)
    recurring('subscription', subscription, reference ? 'mensual' : frequency, subscription.billingDay, {
      subscriptionId: subscription.id, amount: subscription.cost,
      reference,
    })
  }
  for (const plan of plans) {
    if (!plan.configured || plan.completed) continue
    recurring('plan', plan, plan.periodUnit, plan.contributionDay, {
      planId: plan.id, amount: plan.contribution,
    })
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, 'es'))
}
