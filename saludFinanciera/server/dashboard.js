import { pool } from '../../server/db.js'

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function decimalValue(value, label) {
  if (value === '' || value == null) return null
  const text = String(value).trim()
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) {
    throw invalid(`${label} debe tener hasta 13 dígitos y 2 decimales como máximo.`)
  }
  return text
}

export async function getDashboardData(userId) {
  const [accounts] = await pool.execute(
    `SELECT id, nombre AS name, tipo AS type, total, disponible AS available,
            DATE_FORMAT(fecha_corte, '%Y-%m-%d') AS statementDate,
            DATE_FORMAT(fecha_limite_pago, '%Y-%m-%d') AS paymentDueDate,
            pago_para_no_generar_intereses AS paymentToAvoidInterest
     FROM cuenta
     WHERE id_usuario = ?
     ORDER BY nombre, id`,
    [userId],
  )

  const [subscriptions] = await pool.execute(
    `SELECT id, nombre AS name, costo AS cost, monetizado AS monetized,
            frecuencia AS frequency, tipo AS type, costo_mensual AS monthlyCost,
            dia_cobro AS billingDay, tipo_pago AS paymentType, estatus AS status
     FROM suscripciones
     WHERE id_usuario = ?
     ORDER BY nombre, id`,
    [userId],
  )

  const [plans] = await pool.execute(
    `SELECT id, nombre AS name, meta AS goal, monetizado AS saved,
            faltante AS remaining, mostrar AS visible,
            unidad_periodo AS periodUnit, periodos_faltantes AS periodsRemaining
     FROM plan_futuro
     WHERE id_usuario = ?
     ORDER BY nombre, id`,
    [userId],
  )

  const [categories] = await pool.execute(
    `SELECT id, nombre AS name, tipo AS type
     FROM categorias
     ORDER BY tipo, nombre, id`,
  )

  const [movements] = await pool.execute(
    `SELECT m.id, m.monto AS amount,
            DATE_FORMAT(m.fecha, '%Y-%m-%d') AS date,
            m.id_categoria AS categoryId, m.id_plan_futuro AS planId,
            m.id_suscripcion AS subscriptionId,
            m.id_cuenta_origen AS originAccountId,
            m.id_cuenta_destino AS destinationAccountId,
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
     WHERE m.id_usuario = ?
     ORDER BY m.fecha DESC, m.id DESC
     LIMIT 250`,
    [userId],
  )

  const availableTotal = accounts.reduce(
    (totalCents, account) => totalCents + Math.round(Number(account.available || 0) * 100),
    0,
  ) / 100
  const monthlySubscriptionTotal = subscriptions
    .filter((subscription) => subscription.status.toLowerCase() === 'activa')
    .reduce((total, subscription) => {
      const cost = Number(subscription.cost || 0)
      const frequency = String(subscription.frequency || '').toLowerCase()
      const divisor = frequency.includes('anual') ? 12
        : frequency.includes('semestral') ? 6
          : frequency.includes('trimestral') ? 3
            : frequency.includes('mensual') ? 1
              : null
      const monthly = subscription.monthlyCost == null
        ? divisor ? cost / divisor : 0
        : Number(subscription.monthlyCost)
      return total + Math.round(monthly * 100)
    }, 0) / 100

  return {
    accounts,
    subscriptions,
    plans,
    categories,
    movements,
    summary: {
      accountsCount: accounts.length,
      availableTotal,
      activeSubscriptionsCount: subscriptions.filter(
        (subscription) => subscription.status.toLowerCase() === 'activa',
      ).length,
      monthlySubscriptionTotal,
      plansCount: plans.length,
      movementsCount: movements.length,
    },
  }
}

function accountFields(input, includeAvailable = true) {
  const name = String(input.name || '').trim()
  const type = String(input.type || '').trim()
  if (!name || name.length > 100) throw invalid('El nombre de la cuenta es obligatorio.')
  if (!type || type.length > 40) throw invalid('El tipo de cuenta es obligatorio.')

  const total = decimalValue(input.total, 'El total')
  const available = includeAvailable
    ? decimalValue(input.available, 'El saldo disponible') || '0.00'
    : undefined
  const paymentToAvoidInterest = decimalValue(
    input.paymentToAvoidInterest,
    'El pago para evitar intereses',
  )

  const statementDate = input.statementDate || null
  const paymentDueDate = input.paymentDueDate || null
  for (const [label, value] of [
    ['La fecha de corte', statementDate],
    ['La fecha límite de pago', paymentDueDate],
  ]) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw invalid(`${label} no es válida.`)
    }
  }

  return { name, type, total, available, statementDate, paymentDueDate, paymentToAvoidInterest }
}

export async function createAccount(userId, input) {
  const fields = accountFields(input)
  const [result] = await pool.execute(
    `INSERT INTO cuenta
       (id_usuario, nombre, tipo, total, disponible, fecha_corte,
        fecha_limite_pago, pago_para_no_generar_intereses)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, fields.name, fields.type, fields.total, fields.available,
      fields.statementDate, fields.paymentDueDate, fields.paymentToAvoidInterest,
    ],
  )

  return { id: result.insertId }
}

export async function updateAccount(userId, id, input) {
  const fields = accountFields(input, false)
  const [result] = await pool.execute(
    `UPDATE cuenta
     SET nombre = ?, tipo = ?, total = ?, fecha_corte = ?,
         fecha_limite_pago = ?, pago_para_no_generar_intereses = ?
     WHERE id = ? AND id_usuario = ?`,
    [
      fields.name, fields.type, fields.total, fields.statementDate,
      fields.paymentDueDate, fields.paymentToAvoidInterest, id, userId,
    ],
  )
  if (!result.affectedRows) throw invalid('No se encontró la cuenta de tu usuario.', 404)
  return { ok: true, id }
}

export async function deleteAccount(userId, id) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [accounts] = await connection.execute(
      'SELECT id FROM cuenta WHERE id = ? AND id_usuario = ? FOR UPDATE',
      [id, userId],
    )
    if (!accounts.length) throw invalid('No se encontró la cuenta de tu usuario.', 404)

    const [references] = await connection.execute(
      `SELECT COUNT(*) AS count FROM movimiento
       WHERE id_usuario = ? AND (id_cuenta_origen = ? OR id_cuenta_destino = ?)`,
      [userId, id, id],
    )
    if (Number(references[0].count) > 0) {
      throw invalid('No se puede eliminar una cuenta que tiene movimientos asociados.', 409)
    }

    await connection.execute('DELETE FROM cuenta WHERE id = ? AND id_usuario = ?', [id, userId])
    await connection.commit()
    return { ok: true, id }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
