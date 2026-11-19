export function calculatePlanProjection(plan, today = new Date()) {
  const contribution = Math.round(Number(plan.contribution) * 100)
  const day = Number(plan.contributionDay)
  const configured = Number.isSafeInteger(contribution) && contribution > 0 &&
    Number.isInteger(day) && day >= 1 && day <= (plan.periodUnit === 'semana' ? 7 : 31) &&
    ['semana', 'mes'].includes(plan.periodUnit)
  const remaining = Math.max(0, Math.round(Number(plan.goal) * 100) - Math.round(Number(plan.saved) * 100))
  const completed = remaining === 0
  const periodsRemaining = completed ? 0 : configured ? Math.ceil(remaining / contribution) : null
  if (!configured || completed) {
    return { configured, completed, periodsRemaining, nextContributionDate: null, estimatedCompletionDate: null }
  }

  const current = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  // Un movimiento en el periodo actual consume esa fecha; los abonos adicionales siguen permitidos.
  const last = /^\d{4}-\d{2}-\d{2}$/.test(plan.lastContributionDate || '')
    ? new Date(`${plan.lastContributionDate}T00:00:00Z`) : null
  const anchor = last && last >= current ? last : current
  const exclusive = Boolean(last && last >= current)
  let next
  if (plan.periodUnit === 'semana') {
    next = new Date(anchor)
    let offset = (day - (anchor.getUTCDay() || 7) + 7) % 7
    if (exclusive && offset === 0) offset = 7
    next.setUTCDate(next.getUTCDate() + offset)
  } else {
    next = monthlyDate(anchor.getUTCFullYear(), anchor.getUTCMonth(), day)
    if (next < anchor || (exclusive && next.getTime() === anchor.getTime())) {
      next = monthlyDate(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, day)
    }
  }
  const end = plan.periodUnit === 'semana'
    ? new Date(next.getTime() + (periodsRemaining - 1) * 7 * 86400000)
    : monthlyDate(next.getUTCFullYear(), next.getUTCMonth() + periodsRemaining - 1, day)
  return {
    configured, completed, periodsRemaining,
    nextContributionDate: dateText(next), estimatedCompletionDate: dateText(end),
  }
}

function monthlyDate(year, month, day) {
  const date = new Date(Date.UTC(year, month + 1, 0))
  date.setUTCDate(Math.min(day, date.getUTCDate()))
  return date
}

function dateText(date) {
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() > 9999
    ? null : date.toISOString().slice(0, 10)
}
