export const frequencies = ['Semanal', 'Mensual', 'Trimestral', 'Semestral', 'Anual']
export const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

export function isWeekly(frequency) {
  return String(frequency).trim().toLowerCase() === 'semanal'
}

export function calculateCosts(cost, frequency) {
  const charges = { semanal: 52, mensual: 12, trimestral: 4, semestral: 2, anual: 1 }
  const count = charges[String(frequency).trim().toLowerCase()]
  if (!count || !/^\d{1,13}(?:\.\d{1,2})?$/.test(String(cost))) return null
  const [whole, fraction = ''] = String(cost).split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  const annual = cents * BigInt(count)
  const format = (value) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`
  return {
    annualCost: format(annual),
    monthlyCost: format(isWeekly(frequency) ? cents * 4n : (annual + 6n) / 12n),
    chargesPerYear: count,
  }
}

export function daysUntilBilling(frequency, billingDay, today = new Date(), startDate = null) {
  const current = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  const referenceFrequency = !startDate && !isWeekly(frequency) ? 'mensual' : frequency
  const due = nextScheduledDate(referenceFrequency, billingDay, current, startDate)
  return due ? (due - current) / 86400000 : null
}
import { nextScheduledDate } from '../schedule.js'
