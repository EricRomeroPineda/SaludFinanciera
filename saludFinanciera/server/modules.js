import { pool } from '../../server/db.js'
import { invalid, requiredText, decimal, positiveId, requiredDate, depositDetails } from './validation.js'
import { calculatePlanProjection } from '../plan-calculations.js'

export async function getPlans(userId) {
  const [rows] = await pool.execute(
    `SELECT p.id, p.nombre AS name, p.meta AS goal, p.datos_deposito AS depositDetails,
            COALESCE(t.saved, 0) AS saved, p.meta - COALESCE(t.saved, 0) AS remaining,
            p.mostrar AS visible, p.unidad_periodo AS periodUnit,
            p.aportacion_periodo AS contribution, p.dia_aportacion AS contributionDay,
            DATE_FORMAT(p.fecha_inicio, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(t.lastContributionDate, '%Y-%m-%d') AS lastContributionDate
     FROM plan_futuro AS p
     LEFT JOIN (
       SELECT id_plan_futuro, id_usuario, SUM(monto) AS saved, MAX(fecha) AS lastContributionDate
       FROM movimiento WHERE id_usuario = ? GROUP BY id_plan_futuro, id_usuario
     ) AS t ON t.id_plan_futuro = p.id AND t.id_usuario = p.id_usuario
     WHERE p.id_usuario = ?
     ORDER BY p.nombre, p.id`,
    [userId, userId],
  )
  return rows.map((row) => ({ ...row, ...calculatePlanProjection(row) }))
}

export async function lockPlans(connection, userId, ids) {
  const sortedIds = [...new Set(ids.filter((id) => id != null).map(Number))].sort((a, b) => a - b)
  if (!sortedIds.length) return
  const [rows] = await connection.execute(
    `SELECT id FROM plan_futuro WHERE id_usuario = ? AND id IN (${sortedIds.map(() => '?').join(', ')})
     ORDER BY id FOR UPDATE`,
    [userId, ...sortedIds],
  )
  if (rows.length !== sortedIds.length) throw invalid('El plan no pertenece a tu usuario.', 404)
}

export async function syncPlanSavings(connection, userId, ids) {
  for (const id of [...new Set(ids.filter((value) => value != null).map(Number))].sort((a, b) => a - b)) {
    await connection.execute(
      `UPDATE plan_futuro AS p
       SET monetizado = (SELECT COALESCE(SUM(m.monto), 0) FROM movimiento AS m
                         WHERE m.id_plan_futuro = p.id AND m.id_usuario = p.id_usuario)
       WHERE p.id = ? AND p.id_usuario = ?`,
      [id, userId],
    )
  }
}

function planFields(input) {
  const name = requiredText(input.name, 'El nombre de la meta', 100)
  const goal = decimal(input.goal, 'La meta')
  const startDate = requiredDate(input.startDate, 'La fecha de inicio')
  const unitPeriod = input.unitPeriod
  if (!['semana', 'mes'].includes(unitPeriod)) {
    throw invalid('Selecciona un periodo semanal o mensual.')
  }
  const contribution = decimal(input.contribution, 'La aportación por periodo')
  const contributionDay = Number(input.contributionDay)
  const maxDay = unitPeriod === 'semana' ? 7 : 31
  if (!Number.isInteger(contributionDay) || contributionDay < 1 || contributionDay > maxDay) {
    throw invalid(unitPeriod === 'semana'
      ? 'Selecciona un día de lunes a domingo.' : 'El día de aportación debe estar entre 1 y 31.')
  }

  const visible = input.visible === undefined
    ? true
    : input.visible === true || input.visible === 1 || input.visible === '1'
  return { name, goal, unitPeriod, contribution, contributionDay, startDate, visible,
    depositDetails: depositDetails(input.depositDetails) }
}

export async function createPlan(userId, input) {
  const fields = planFields(input)
  const [result] = await pool.execute(
    `INSERT INTO plan_futuro
       (id_usuario, nombre, meta, monetizado, mostrar, unidad_periodo, aportacion_periodo, dia_aportacion, fecha_inicio, datos_deposito)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [
      userId, fields.name, fields.goal, fields.visible,
      fields.unitPeriod, fields.contribution, fields.contributionDay, fields.startDate, fields.depositDetails,
    ],
  )

  return { id: result.insertId }
}

export async function updatePlan(userId, idValue, input) {
  const id = positiveId(idValue, 'El plan')
  const fields = planFields(input)
  const [result] = await pool.execute(
    `UPDATE plan_futuro
     SET nombre = ?, meta = ?, mostrar = ?, unidad_periodo = ?, aportacion_periodo = ?, dia_aportacion = ?, fecha_inicio = ?, datos_deposito = ?
     WHERE id = ? AND id_usuario = ?`,
    [
      fields.name, fields.goal, fields.visible, fields.unitPeriod,
      fields.contribution, fields.contributionDay, fields.startDate, fields.depositDetails, id, userId,
    ],
  )
  if (!result.affectedRows) throw invalid('No se encontró el plan de tu usuario.', 404)
  return { ok: true, id }
}

export async function deletePlan(userId, idValue) {
  const id = positiveId(idValue, 'El plan')
  const [rows] = await pool.execute(
    'SELECT id FROM plan_futuro WHERE id = ? AND id_usuario = ?',
    [id, userId],
  )
  if (!rows.length) throw invalid('No se encontró el plan de tu usuario.', 404)

  const [references] = await pool.execute(
    'SELECT COUNT(*) AS count FROM movimiento WHERE id_plan_futuro = ? AND id_usuario = ?',
    [id, userId],
  )
  if (Number(references[0].count) > 0) {
    throw invalid('No se puede eliminar un plan que ya tiene movimientos relacionados.', 409)
  }
  await pool.execute('DELETE FROM plan_futuro WHERE id = ? AND id_usuario = ?', [id, userId])
  return { ok: true, id }
}
