import { pool } from './db.js'

function invalid(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function requiredText(value, label, maxLength) {
  const text = String(value || '').trim()
  if (!text || text.length > maxLength) {
    throw invalid(`${label} es obligatorio y no debe exceder ${maxLength} caracteres.`)
  }
  return text
}

function decimal(value, label, allowZero = false) {
  const text = String(value ?? '').trim()
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) {
    throw invalid(`${label} debe tener hasta 13 dígitos y 2 decimales como máximo.`)
  }
  if (!allowZero && Number(text) <= 0) throw invalid(`${label} debe ser mayor que cero.`)
  return text
}

function subscriptionFields(input) {
  const name = requiredText(input.name, 'El nombre', 100)
  const cost = decimal(input.cost, 'El costo')
  const frequency = requiredText(input.frequency, 'La frecuencia', 30)
  const type = String(input.type || '')
  if (!['servicio', 'suscripcion'].includes(type)) {
    throw invalid('El tipo debe ser servicio o suscripcion.')
  }

  let monthlyCost = input.monthlyCost == null || input.monthlyCost === ''
    ? null
    : decimal(input.monthlyCost, 'El costo mensual', true)
  if (monthlyCost == null) {
    const frequencyKey = frequency.toLowerCase()
    const divisor = frequencyKey.includes('anual') ? 12
      : frequencyKey.includes('semestral') ? 6
        : frequencyKey.includes('trimestral') ? 3
          : frequencyKey.includes('mensual') ? 1
            : null
    if (divisor) monthlyCost = (Number(cost) / divisor).toFixed(2)
  }

  const billingDay = input.billingDay == null || input.billingDay === ''
    ? null
    : Number(input.billingDay)
  if (billingDay != null && (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31)) {
    throw invalid('El día de cobro debe estar entre 1 y 31.')
  }

  const paymentType = input.paymentType == null || input.paymentType === ''
    ? null
    : requiredText(input.paymentType, 'El método de pago', 40)

  const status = input.status == null ? 'activa' : requiredText(input.status, 'El estado', 30)
  return { name, cost, frequency, type, monthlyCost, billingDay, paymentType, status }
}

function positiveId(value, label) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw invalid(`${label} no es válido.`)
  return id
}

export async function createSubscription(userId, input) {
  const fields = subscriptionFields(input)
  const [result] = await pool.execute(
    `INSERT INTO suscripciones
       (id_usuario, nombre, costo, frecuencia, tipo, costo_mensual,
        dia_cobro, tipo_pago, estatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, fields.name, fields.cost, fields.frequency, fields.type,
      fields.monthlyCost, fields.billingDay, fields.paymentType, fields.status,
    ],
  )

  return { id: result.insertId }
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
  return { ok: true, id }
}

export async function deleteSubscription(userId, idValue) {
  const id = positiveId(idValue, 'La suscripción')
  const [rows] = await pool.execute(
    'SELECT id FROM suscripciones WHERE id = ? AND id_usuario = ?',
    [id, userId],
  )
  if (!rows.length) throw invalid('No se encontró la suscripción de tu usuario.', 404)

  const [references] = await pool.execute(
    'SELECT COUNT(*) AS count FROM movimiento WHERE id_suscripcion = ? AND id_usuario = ?',
    [id, userId],
  )
  if (Number(references[0].count) > 0) {
    await pool.execute(
      'UPDATE suscripciones SET estatus = ? WHERE id = ? AND id_usuario = ?',
      ['cancelada', id, userId],
    )
    return { ok: true, id, cancelled: true }
  }

  await pool.execute('DELETE FROM suscripciones WHERE id = ? AND id_usuario = ?', [id, userId])
  return { ok: true, id, cancelled: false }
}

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
