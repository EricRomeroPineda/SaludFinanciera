import { pool } from '../../server/db.js'
import { invalid, requiredText, decimal, positiveId } from '../server/validation.js'
import { calculateCosts, isImageUrl, isWeekly } from './calculations.js'

export async function getSubscriptions(userId, id = null) {
  const [rows] = await pool.execute(
    `SELECT s.id, s.nombre AS name, s.costo AS cost,
            COALESCE((SELECT SUM(m.monto) FROM movimiento AS m
                      WHERE m.id_suscripcion = s.id AND m.id_usuario = s.id_usuario), 0) AS monetized,
            s.frecuencia AS frequency, s.tipo AS type, s.costo_mensual AS monthlyCost,
            s.dia_cobro AS billingDay, s.tipo_pago AS paymentType, s.estatus AS status
     FROM suscripciones AS s
     WHERE s.id_usuario = ?${id == null ? '' : ' AND s.id = ?'}
     ORDER BY s.nombre, s.id`,
    id == null ? [userId] : [userId, id],
  )
  return rows.map((row) => {
    const costs = calculateCosts(row.cost, row.frequency)
    return { ...row, monthlyCost: costs?.monthlyCost ?? null, annualCost: costs?.annualCost ?? null }
  })
}

async function getSubscription(userId, id) {
  const rows = await getSubscriptions(userId, id)
  if (!rows.length) throw invalid('No se encontró la suscripción de tu usuario.', 404)
  return rows[0]
}

export async function lockSubscriptions(connection, userId, ids) {
  const sortedIds = [...new Set(ids.filter((id) => id != null).map(Number))].sort((a, b) => a - b)
  if (!sortedIds.length) return
  const [rows] = await connection.execute(
    `SELECT id FROM suscripciones WHERE id_usuario = ? AND id IN (${sortedIds.map(() => '?').join(', ')})
     ORDER BY id FOR UPDATE`,
    [userId, ...sortedIds],
  )
  if (rows.length !== sortedIds.length) throw invalid('La suscripción no pertenece a tu usuario.', 404)
}

export async function syncMonetized(connection, userId, ids) {
  for (const id of [...new Set(ids.filter((value) => value != null).map(Number))].sort((a, b) => a - b)) {
    await connection.execute(
      `UPDATE suscripciones AS s
       SET monetizado = (SELECT COALESCE(SUM(m.monto), 0) FROM movimiento AS m
                         WHERE m.id_suscripcion = s.id AND m.id_usuario = s.id_usuario)
       WHERE s.id = ? AND s.id_usuario = ?`,
      [id, userId],
    )
  }
}

function subscriptionFields(input) {
  const name = requiredText(input.name, 'El nombre', 100)
  const cost = decimal(input.cost, 'El costo')
  const frequency = requiredText(input.frequency, 'La frecuencia', 30)
  const type = String(input.type || '')
  if (!['servicio', 'suscripcion'].includes(type)) {
    throw invalid('El tipo debe ser servicio o suscripcion.')
  }

  const costs = calculateCosts(cost, frequency)
  if (!costs) throw invalid('Selecciona una frecuencia semanal, mensual, trimestral, semestral o anual.')
  const monthlyCost = decimal(costs.monthlyCost, 'El costo mensual calculado', true)

  const billingDay = input.billingDay == null || input.billingDay === ''
    ? null
    : Number(input.billingDay)
  const maxDay = isWeekly(frequency) ? 7 : 31
  if (billingDay != null && (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > maxDay)) {
    throw invalid(isWeekly(frequency) ? 'Selecciona un día de lunes a domingo.' : 'El día de cobro debe estar entre 1 y 31.')
  }

  const paymentType = input.paymentType == null || input.paymentType === ''
    ? null
    : requiredText(input.paymentType, 'La URL de imagen', 40)
  if (paymentType && !isImageUrl(paymentType)) throw invalid('La imagen debe ser una URL HTTPS de hasta 40 caracteres.')

  const status = input.status == null ? 'activa' : requiredText(input.status, 'El estado', 30)
  return { name, cost, frequency, type, monthlyCost, billingDay, paymentType, status }
}

export async function createSubscription(userId, input) {
  const fields = subscriptionFields(input)
  const [result] = await pool.execute(
    `INSERT INTO suscripciones
       (id_usuario, nombre, costo, frecuencia, tipo, costo_mensual, monetizado,
        dia_cobro, tipo_pago, estatus)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      userId, fields.name, fields.cost, fields.frequency, fields.type,
      fields.monthlyCost, fields.billingDay, fields.paymentType, fields.status,
    ],
  )

  return { id: result.insertId, subscription: await getSubscription(userId, result.insertId) }
}

export async function updateSubscription(userId, idValue, input) {
  const id = positiveId(idValue, 'La suscripción')
  const fields = subscriptionFields(input)
  const [result] = await pool.execute(
    `UPDATE suscripciones
     SET nombre = ?, costo = ?, frecuencia = ?, tipo = ?, costo_mensual = ?,
         dia_cobro = ?, tipo_pago = ?, estatus = ?
     WHERE id = ? AND id_usuario = ?`,
    [
      fields.name, fields.cost, fields.frequency, fields.type, fields.monthlyCost,
      fields.billingDay, fields.paymentType, fields.status, id, userId,
    ],
  )
  if (!result.affectedRows) throw invalid('No se encontró la suscripción de tu usuario.', 404)
  return { ok: true, id, subscription: await getSubscription(userId, id) }
}

export async function deleteSubscription(userId, idValue) {
  const id = positiveId(idValue, 'La suscripción')
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await lockSubscriptions(connection, userId, [id])
    const [references] = await connection.execute(
      'SELECT COUNT(*) AS count FROM movimiento WHERE id_suscripcion = ? AND id_usuario = ?',
      [id, userId],
    )
    const cancelled = Number(references[0].count) > 0
    if (cancelled) {
      await connection.execute(
        'UPDATE suscripciones SET estatus = ? WHERE id = ? AND id_usuario = ?',
        ['cancelada', id, userId],
      )
    } else {
      await connection.execute('DELETE FROM suscripciones WHERE id = ? AND id_usuario = ?', [id, userId])
    }
    await connection.commit()
    return { ok: true, id, cancelled }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
