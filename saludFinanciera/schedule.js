export function parseScheduleDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return null
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() >= 1000 &&
    date.getUTCFullYear() <= 9999 && date.toISOString().slice(0, 10) === value ? date : null
}

export function nextScheduledDate(frequency, dayValue, from, startDate = null) {
  const normalized = String(frequency).trim().toLowerCase()
  const weekly = ['semana', 'semanal'].includes(normalized)
  const stride = { mes: 1, mensual: 1, trimestral: 3, semestral: 6, anual: 12 }[normalized]
  const day = Number(dayValue)
  if ((!weekly && !stride) || !Number.isInteger(day) || day < 1 || day > (weekly ? 7 : 31)) return null
  const start = parseScheduleDate(startDate)
  if (startDate != null && !start) return null
  const anchor = start && start > from ? start : from
  if (weekly) {
    const date = new Date(anchor)
    date.setUTCDate(date.getUTCDate() + (day - (date.getUTCDay() || 7) + 7) % 7)
    return date.getUTCFullYear() <= 9999 ? date : null
  }
  const anchorMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth()
  const startMonth = start ? start.getUTCFullYear() * 12 + start.getUTCMonth() : anchorMonth
  let monthIndex = startMonth + Math.max(0, Math.ceil((anchorMonth - startMonth) / stride)) * stride
  const monthDate = (index) => {
    const date = new Date(Date.UTC(Math.floor(index / 12), index % 12 + 1, 0))
    date.setUTCDate(Math.min(day, date.getUTCDate()))
    return date
  }
  let date = monthDate(monthIndex)
  if (date < anchor) {
    monthIndex += stride
    date = monthDate(monthIndex)
  }
  return date.getUTCFullYear() <= 9999 ? date : null
}
