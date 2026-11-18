import { pool } from '../../server/db.js'

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

export async function getCalendarData(userId, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw invalid('El mes debe tener formato AAAA-MM.')
  }
  const [yearText, monthText] = month.split('-')
  const year = Number(yearText)
  const monthNumber = Number(monthText)
  if (monthNumber < 1 || monthNumber > 12) throw invalid('El mes no es válido.')

  const start = `${month}-01`
  const endDate = new Date(Date.UTC(year, monthNumber, 1))
  const end = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-01`
  const [days] = await pool.execute(
    `SELECT DATE_FORMAT(m.fecha, '%Y-%m-%d') AS day,
            COUNT(*) AS count,
            SUM(CASE
              WHEN cat.tipo = 'ingreso'
                OR (m.id_cuenta_origen IS NULL AND m.id_cuenta_destino IS NOT NULL)
              THEN m.monto ELSE 0 END) AS income,
            SUM(CASE
              WHEN cat.tipo = 'gasto'
                OR (m.id_cuenta_origen IS NOT NULL AND m.id_cuenta_destino IS NULL)
              THEN m.monto ELSE 0 END) AS expenses
     FROM movimiento AS m
     LEFT JOIN categorias AS cat ON cat.id = m.id_categoria
     WHERE m.id_usuario = ? AND m.fecha >= ? AND m.fecha < ?
     GROUP BY DATE(m.fecha)
     ORDER BY day`,
    [userId, start, end],
  )

  const [categories] = await pool.execute(
    `SELECT cat.nombre AS name, cat.tipo AS type,
            SUM(m.monto) AS total, COUNT(*) AS count
     FROM movimiento AS m
     INNER JOIN categorias AS cat ON cat.id = m.id_categoria
     WHERE m.id_usuario = ? AND m.fecha >= ? AND m.fecha < ?
     GROUP BY cat.id, cat.nombre, cat.tipo
     ORDER BY total DESC, cat.nombre`,
    [userId, start, end],
  )

  const [movements] = await pool.execute(
    `SELECT m.id, m.monto AS amount,
            DATE_FORMAT(m.fecha, '%Y-%m-%d') AS date,
            cat.nombre AS category, cat.tipo AS categoryType,
            plan.nombre AS planName, sub.nombre AS subscriptionName,
            origin.nombre AS originAccount, destination.nombre AS destinationAccount
     FROM movimiento AS m
     LEFT JOIN categorias AS cat ON cat.id = m.id_categoria
     LEFT JOIN plan_futuro AS plan
       ON plan.id = m.id_plan_futuro AND plan.id_usuario = m.id_usuario
     LEFT JOIN suscripciones AS sub
       ON sub.id = m.id_suscripcion AND sub.id_usuario = m.id_usuario
     LEFT JOIN cuenta AS origin
       ON origin.id = m.id_cuenta_origen AND origin.id_usuario = m.id_usuario
     LEFT JOIN cuenta AS destination
       ON destination.id = m.id_cuenta_destino AND destination.id_usuario = m.id_usuario
     WHERE m.id_usuario = ? AND m.fecha >= ? AND m.fecha < ?
     ORDER BY m.fecha DESC, m.id DESC`,
    [userId, start, end],
  )

  return {
    month,
    days: days.map((item) => ({
      ...item,
      count: Number(item.count),
      income: Number(item.income || 0),
      expenses: Number(item.expenses || 0),
    })),
    categories: categories.map((item) => ({
      ...item,
      total: Number(item.total || 0),
      count: Number(item.count),
    })),
    movements: movements.map((item) => ({
      ...item,
      amount: Number(item.amount),
    })),
  }
}
