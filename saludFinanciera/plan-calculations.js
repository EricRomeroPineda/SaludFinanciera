export function calculatePlanProjection(plan, today = new Date()) {
  const periods = Number(plan.periodsRemaining)
  const configured = plan.periodsRemaining != null && String(plan.periodsRemaining).trim() !== '' &&
    Number.isSafeInteger(periods) && periods >= 0 && periods <= 4294967295 &&
    ['semana', 'mes', 'anio'].includes(plan.periodUnit)
  const completed = Math.round(Number(plan.saved) * 100) >= Math.round(Number(plan.goal) * 100)
  if (!configured || completed) return { configured, completed, estimatedCompletionDate: null }

  const current = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  let date
  if (plan.periodUnit === 'semana') {
    date = new Date(current)
    date.setUTCDate(date.getUTCDate() + periods * 7)
  } else {
    const months = periods * (plan.periodUnit === 'anio' ? 12 : 1)
    date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + months + 1, 0))
    date.setUTCDate(Math.min(current.getUTCDate(), date.getUTCDate()))
  }
  const estimatedCompletionDate = Number.isNaN(date.getTime()) || date.getUTCFullYear() > 9999
    ? null : date.toISOString().slice(0, 10)
  return { configured, completed, estimatedCompletionDate }
}
