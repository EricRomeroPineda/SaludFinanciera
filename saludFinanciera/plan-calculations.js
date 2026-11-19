export function parsePlanDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null
  const [, year, month, day] = match.map(Number)
  if (year < 1000 || year > 9999) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day ? date : null
}

function periodDate(first, unit, index) {
  if (unit === 'semana') {
    const date = new Date(first)
    date.setUTCDate(date.getUTCDate() + index * 7)
    return date
  }
  const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index + 1, 0))
  date.setUTCDate(Math.min(first.getUTCDate(), date.getUTCDate()))
  return date
}

function dateText(date) {
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() > 9999
    ? null : date.toISOString().slice(0, 10)
}

function nextPeriodIndex(first, unit, date, after = false) {
  if (date < first) return 0
  if (unit === 'semana') {
    const periods = (date - first) / (7 * 86400000)
    return after ? Math.floor(periods) + 1 : Math.ceil(periods)
  }
  let index = (date.getUTCFullYear() - first.getUTCFullYear()) * 12 +
    date.getUTCMonth() - first.getUTCMonth()
  const scheduled = periodDate(first, unit, index)
  if (scheduled < date || (after && scheduled.getTime() === date.getTime())) index++
  return index
}

export function calculatePlanProjection(plan, today = new Date()) {
  const goal = Math.round(Number(plan.goal) * 100)
  const saved = Math.round(Number(plan.saved) * 100)
  const contribution = Math.round(Number(plan.contribution) * 100)
  const remaining = Math.max(0, goal - saved)
  const first = parsePlanDate(plan.firstContributionDate)
  const configured = Boolean(first && ['semana', 'mes'].includes(plan.periodUnit) &&
    Number.isSafeInteger(contribution) && contribution > 0)
  const completed = remaining === 0
  if (!configured || completed) {
    return {
      configured, completed, periodsRemaining: completed ? 0 : null,
      nextContributionDate: null, estimatedCompletionDate: null,
    }
  }

  const current = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  const elapsed = nextPeriodIndex(first, plan.periodUnit, current)
  const lastContribution = parsePlanDate(plan.lastContributionDate)
  const afterLastContribution = lastContribution
    ? nextPeriodIndex(first, plan.periodUnit, lastContribution, true) : 0

  // No proyectar otra cuota en una fecha ya utilizada ni duplicar periodos pagados por adelantado.
  const nextIndex = Math.max(elapsed, afterLastContribution, Math.floor(saved / contribution))
  const periodsRemaining = Math.ceil(remaining / contribution)
  return {
    configured, completed, periodsRemaining,
    nextContributionDate: dateText(periodDate(first, plan.periodUnit, nextIndex)),
    estimatedCompletionDate: dateText(periodDate(first, plan.periodUnit, nextIndex + periodsRemaining - 1)),
  }
}
