import { getFamily } from '../../server/family.js'
import { getDashboardData } from './dashboard.js'
import { getCalendarData } from './calendar.js'
import { getRelatedMovements } from './movements.js'
import { getSubscriptions } from '../suscripciones/service.js'
import { getLoans } from './loans.js'
import { pool } from '../../server/db.js'

function tagRows(rows, member) {
  return rows.map((row) => ({
    ...row, ownerId: row.movementOwnerId || member.id, ownerName: row.senderName || member.name,
    ownerTheme: member.theme, ownerAppearance: member.appearance,
    ...(row.name ? { name: `${row.name} · ${member.name}` } : {}),
    ...Object.fromEntries(['originAccount', 'destinationAccount', 'planName', 'subscriptionName', 'loanName', 'accountName']
      .filter((key) => row[key] && !(row.recipientUserId && ['originAccount', 'destinationAccount'].includes(key)))
      .map((key) => [key, `${row[key]} · ${member.name}`])),
  }))
}

function sumBy(rows, key, values) {
  const grouped = new Map()
  for (const row of rows) {
    const id = key(row)
    if (!grouped.has(id)) grouped.set(id, { ...row, ...Object.fromEntries(values.map((field) => [field, 0])) })
    const target = grouped.get(id)
    for (const field of values) {
      target[field] = field === 'count' ? target[field] + Number(row[field])
        : (Math.round(target[field] * 100) + Math.round(Number(row[field]) * 100)) / 100
    }
  }
  return [...grouped.values()]
}

const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.id - a.id
const uniqueMovements = (rows) => [...new Map(rows.map((row) => [row.id, row])).values()]

export async function getFamilyTransferAccounts(userId) {
  const { family } = await getFamily(userId)
  if (!family) throw Object.assign(new Error('Debes pertenecer a una familia para registrar este movimiento.'), { statusCode: 403 })
  const ids = family.members.map((member) => member.id)
  const [accounts] = await pool.execute(
    `SELECT id, nombre AS name, tipo AS type, disponible AS available, id_usuario AS ownerId
     FROM cuenta WHERE id_usuario IN (${ids.map(() => '?').join(', ')}) ORDER BY nombre, id`, ids,
  )
  const members = new Map(family.members.map((member) => [Number(member.id), member]))
  return {
    userId,
    accounts: accounts.map((account) => {
      const owner = members.get(Number(account.ownerId))
      return { ...account, ownerName: owner.name, ownerTheme: owner.theme, ownerAppearance: owner.appearance }
    }),
  }
}

export async function getFamilyView(userId, resource, url) {
  const { family } = await getFamily(userId)
  if (!family) throw Object.assign(new Error('Ya no perteneces a una familia. Regresa a la vista individual.'), { statusCode: 403 })
  const members = family.members
  if (resource === 'dashboard') {
    const data = await Promise.all(members.map(async (member) => {
      const dashboard = await getDashboardData(member.id)
      return {
        ...dashboard,
        ...Object.fromEntries(['accounts', 'plans', 'subscriptions', 'movements', 'loans']
          .map((key) => [key, tagRows(dashboard[key], member)])),
      }
    }))
    const accounts = data.flatMap((item) => item.accounts)
    const plans = data.flatMap((item) => item.plans)
    const subscriptions = data.flatMap((item) => item.subscriptions)
    const movements = uniqueMovements(data.flatMap((item) => item.movements)).sort(newestFirst).slice(0, 250)
    return {
      family, viewerId: userId, accounts, plans, subscriptions, movements, loans: data.flatMap((item) => item.loans), categories: data[0].categories,
      activityByMonth: sumBy(data.flatMap((item) => item.activityByMonth), (row) => row.month, ['income', 'expenses', 'investment'])
        .sort((a, b) => a.month.localeCompare(b.month)),
      summary: {
        accountsCount: accounts.length, plansCount: plans.length, movementsCount: movements.length,
        activeSubscriptionsCount: data.reduce((sum, item) => sum + item.summary.activeSubscriptionsCount, 0),
        monthlySubscriptionTotal: data.reduce((sum, item) => sum + Math.round(item.summary.monthlySubscriptionTotal * 100), 0) / 100,
        availableTotal: accounts.reduce((sum, item) => sum + Math.round(Number(item.available || 0) * 100), 0) / 100,
      },
    }
  }
  if (resource === 'calendar') {
    const month = url.searchParams.get('month') || ''
    const scope = url.searchParams.get('scope') || 'month'
    const data = await Promise.all(members.map(async (member) => {
      const calendar = await getCalendarData(member.id, month, scope)
      return {
        ...calendar, movements: tagRows(calendar.movements, member),
        events: tagRows(calendar.events, member).map((event) => ({
          ...event, label: `${event.label} · ${member.name}`,
        })),
      }
    }))
    const movements = uniqueMovements(data.flatMap((item) => item.movements)).sort(newestFirst)
    const days = sumBy(data.flatMap((item) => item.days), (row) => row.day, ['count', 'income', 'expenses'])
    const seen = new Set()
    for (const movement of data.flatMap((item) => item.movements)) {
      if (seen.has(movement.id)) {
        const day = days.find((item) => item.day === movement.date)
        if (day) day.count--
      }
      seen.add(movement.id)
    }
    return {
      month, scope,
      events: data.flatMap((item) => item.events),
      movements,
      days: days.sort((a, b) => a.day.localeCompare(b.day)),
      categories: sumBy(data.flatMap((item) => item.categories), (row) => JSON.stringify([row.name, row.type]), ['count', 'total'])
        .sort((a, b) => b.total - a.total),
    }
  }
  if (resource === 'subscriptions') {
    const rows = await Promise.all(members.map(async (member) => tagRows(await getSubscriptions(member.id), member)))
    return { subscriptions: rows.flat() }
  }
  if (resource === 'loans') {
    const rows = await Promise.all(members.map(async (member) => tagRows(await getLoans(member.id), member)))
    return { loans: rows.flat() }
  }
  if (resource === 'movements') {
    const rows = await Promise.all(members.map(async (member) => {
      const { movements } = await getRelatedMovements(member.id, url.searchParams.get('relation'), url.searchParams.get('id'))
      return tagRows(movements, member)
    }))
    return { movements: uniqueMovements(rows.flat()).sort(newestFirst) }
  }
  throw Object.assign(new Error('Consulta familiar no válida.'), { statusCode: 404 })
}
