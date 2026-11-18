import { pool } from '../../server/db.js'
import { invalid, requiredText, decimal, positiveId } from './validation.js'

function planFields(input) {
  const name = requiredText(input.name, 'El nombre de la meta', 100)
  const goal = decimal(input.goal, 'La meta')
  const unitPeriod = input.unitPeriod || null
  if (unitPeriod && !['semana', 'mes', 'anio'].includes(unitPeriod)) {
    throw invalid('La unidad del periodo debe ser semana, mes o anio.')
  }

  const periodsRemaining = input.periodsRemaining == null || input.periodsRemaining === ''
    ? null
    : Number(input.periodsRemaining)
  if (
    periodsRemaining != null &&
    (!Number.isSafeInteger(periodsRemaining) || periodsRemaining < 0 || periodsRemaining > 4294967295)
  ) {
    throw invalid('Los periodos faltantes deben ser un entero no negativo.')
  }

  const visible = input.visible === undefined
    ? true
    : input.visible === true || input.visible === 1 || input.visible === '1'
  return { name, goal, unitPeriod, periodsRemaining, visible }
}

export async function createPlan(userId, input) {
  const fields = planFields(input)
  const [result] = await pool.execute(
    `INSERT INTO plan_futuro
       (id_usuario, nombre, meta, mostrar, unidad_periodo, periodos_faltantes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId, fields.name, fields.goal, fields.visible,
      fields.unitPeriod, fields.periodsRemaining,
    ],
  )

  return { id: result.insertId }
}

export async function updatePlan(userId, idValue, input) {
  const id = positiveId(idValue, 'El plan')
  const fields = planFields(input)
  const [result] = await pool.execute(
    `UPDATE plan_futuro
     SET nombre = ?, meta = ?, mostrar = ?, unidad_periodo = ?, periodos_faltantes = ?
     WHERE id = ? AND id_usuario = ?`,
    [
      fields.name, fields.goal, fields.visible, fields.unitPeriod,
      fields.periodsRemaining, id, userId,
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
