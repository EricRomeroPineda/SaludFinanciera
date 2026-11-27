import { getSubscriptions } from '../suscripciones/service.js'
import { pool } from '../../server/db.js'
import { isCreditAccount } from '../account-types.js'
import { getPlans } from './modules.js'
import { getLoans } from './loans.js'
import { depositDetails } from './validation.js'
import { movementSharingFields, describeSharedMovement } from './movement-sharing.js'

function invalid(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
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
            pago_para_no_generar_intereses AS paymentToAvoidInterest, datos_deposito AS depositDetails,
            DATE_FORMAT(fecha_pago_confirmado, '%Y-%m-%d') AS confirmedPaymentDueDate,
            monto_pago_confirmado AS confirmedPaymentAmount,
            (SELECT COALESCE(SUM(payment.monto), 0)
             FROM movimiento AS payment
             WHERE (payment.id_usuario = cuenta.id_usuario OR payment.id_usuario_destino = cuenta.id_usuario)
               AND payment.id_cuenta_destino = cuenta.id
               AND payment.id_cuenta_origen IS NOT NULL
               AND payment.id_categoria IS NULL AND payment.id_prestamo IS NULL
               AND payment.fecha > DATE_SUB(cuenta.fecha_limite_pago, INTERVAL 1 MONTH)
               AND payment.fecha < DATE_ADD(CURDATE(), INTERVAL 1 DAY)) AS paymentTransfers
     FROM cuenta
     WHERE id_usuario = ?
     ORDER BY nombre, id`,
    [userId],
  )

  const subscriptions = await getSubscriptions(userId)

  const plans = await getPlans(userId)

  const [categories] = await pool.execute(
    `SELECT id, nombre AS name, tipo AS type
     FROM categorias
     ORDER BY tipo, nombre, id`,
  )

  const [movements] = await pool.execute(
    `SELECT m.id, m.monto AS amount, ${movementSharingFields},
            EXISTS(SELECT 1 FROM movimiento_evidencia AS e WHERE e.id_movimiento = m.id) AS hasEvidence,
            DATE_FORMAT(m.fecha, '%Y-%m-%d') AS date,
            m.id_categoria AS categoryId, m.id_plan_futuro AS planId,
            m.id_suscripcion AS subscriptionId,
            m.id_cuenta_origen AS originAccountId,
            m.id_cuenta_destino AS destinationAccountId,
            cat.nombre AS category, cat.tipo AS categoryType,
            plan.nombre AS planName, sub.nombre AS subscriptionName,
            origin.nombre AS originAccount, destination.nombre AS destinationAccount,
            m.id_prestamo AS loanId, m.clase_prestamo AS loanKind, loan.persona AS loanName
     FROM movimiento AS m
     LEFT JOIN categorias AS cat ON cat.id = m.id_categoria
     LEFT JOIN plan_futuro AS plan
       ON plan.id = m.id_plan_futuro AND plan.id_usuario = m.id_usuario
     LEFT JOIN suscripciones AS sub
       ON sub.id = m.id_suscripcion AND sub.id_usuario = m.id_usuario
     LEFT JOIN cuenta AS origin
       ON origin.id = m.id_cuenta_origen AND origin.id_usuario = m.id_usuario
     LEFT JOIN cuenta AS destination
       ON destination.id = m.id_cuenta_destino
         AND destination.id_usuario = COALESCE(m.id_usuario_destino, m.id_usuario)
     LEFT JOIN prestamo AS loan ON loan.id = m.id_prestamo AND loan.id_usuario = m.id_usuario
     WHERE (m.id_usuario = ? OR m.id_usuario_destino = ?)
     ORDER BY m.fecha DESC, m.id DESC
     LIMIT 250`,
    [userId, userId],
  )

  const [activityByMonth] = await pool.execute(
    `SELECT DATE_FORMAT(m.fecha, '%Y-%m') AS month,
            SUM(CASE WHEN m.id_prestamo IS NULL AND (cat.tipo = 'ingreso'
              OR (m.id_cuenta_origen IS NULL AND m.id_cuenta_destino IS NOT NULL))
              THEN m.monto ELSE 0 END) AS income,
            SUM(CASE WHEN m.id_prestamo IS NULL AND m.id_plan_futuro IS NULL AND (cat.tipo = 'gasto'
              OR (m.id_cuenta_origen IS NOT NULL AND m.id_cuenta_destino IS NULL))
              THEN m.monto ELSE 0 END) AS expenses,
            SUM(CASE WHEN m.id_plan_futuro IS NOT NULL AND m.id_prestamo IS NULL
              AND m.id_cuenta_origen IS NOT NULL AND m.id_cuenta_destino IS NULL
              THEN m.monto ELSE 0 END) AS investment
     FROM movimiento AS m
     LEFT JOIN categorias AS cat ON cat.id = m.id_categoria
     WHERE m.id_usuario = ?
     GROUP BY DATE_FORMAT(m.fecha, '%Y-%m')
     ORDER BY month`,
    [userId],
  )

  const availableTotal = accounts.reduce(
    (totalCents, account) => totalCents + Math.round(Number(account.available || 0) * 100),
    0,
  ) / 100
  const monthlySubscriptionTotal = subscriptions
    .filter((subscription) => subscription.status.toLowerCase() === 'activa')
    .reduce((total, subscription) => {
      const monthly = Number(subscription.monthlyCost || 0)
      return total + Math.round(monthly * 100)
    }, 0) / 100

  return {
    accounts,
    subscriptions,
    plans,
    categories,
    movements: movements.map((movement) => describeSharedMovement(movement, userId)),
    activityByMonth,
    loans: await getLoans(userId),
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

export async function confirmAccountPayment(userId, id, input) {
  if (typeof input.confirmed !== 'boolean'
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.paymentDueDate || ''))) {
    throw invalid('Indica la fecha límite y si confirmas o retiras la confirmación del pago.')
  }
  const amount = decimalValue(input.paymentToAvoidInterest, 'El pago para evitar intereses')
  if (amount == null) throw invalid('Indica el importe del pago que estás confirmando.')
  const [result] = await pool.execute(
    `UPDATE cuenta
     SET fecha_pago_confirmado = CASE WHEN ? THEN fecha_limite_pago ELSE NULL END,
         monto_pago_confirmado = CASE WHEN ? THEN pago_para_no_generar_intereses ELSE NULL END
     WHERE id = ? AND id_usuario = ?
       AND tipo IN ('Tarjeta de crédito', 'Crédito')
       AND fecha_limite_pago = ? AND pago_para_no_generar_intereses = ?`,
    [input.confirmed, input.confirmed, id, userId, input.paymentDueDate, amount],
  )
  if (!result.affectedRows) {
    throw invalid('La tarjeta no está disponible o cambió su fecha o importe. Actualiza el panorama antes de confirmar.', 409)
  }
  return { ok: true, id }
}

function accountFields(input) {
  const name = String(input.name || '').trim()
  const type = String(input.type || '').trim()
  if (!name || name.length > 100) throw invalid('El nombre de la cuenta es obligatorio.')
  if (!['Tarjeta de crédito', 'Tarjeta de débito', 'Efectivo'].includes(type)) {
    throw invalid('Selecciona Crédito, Débito o Efectivo como tipo de cuenta.')
  }

  const credit = isCreditAccount(type)
  const total = credit ? decimalValue(input.total, 'El total') : null
  const available = decimalValue(input.available, 'El saldo disponible')
  if (available == null) {
    throw invalid('Captura el saldo disponible actual; si no tienes disponible, introduce 0.')
  }
  const paymentToAvoidInterest = !credit ? null : decimalValue(
    input.paymentToAvoidInterest,
    'El pago para evitar intereses',
  )

  const statementDate = credit ? input.statementDate || null : null
  const paymentDueDate = credit ? input.paymentDueDate || null : null
  if (credit) {
    if (total == null || !statementDate || !paymentDueDate || paymentToAvoidInterest == null) {
      throw invalid('El crédito requiere límite máximo, fecha de corte, fecha límite de pago y pago para no generar intereses de este mes.')
    }
    if (Number(available) > Number(total)) {
      throw invalid('El crédito disponible no puede superar el límite máximo.')
    }
  }
  for (const [label, value] of [
    ['La fecha de corte', statementDate],
    ['La fecha límite de pago', paymentDueDate],
  ]) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw invalid(`${label} no es válida.`)
    }
  }

  return { name, type, total, available, statementDate, paymentDueDate, paymentToAvoidInterest,
    depositDetails: depositDetails(input.depositDetails) }
}

export async function createAccount(userId, input) {
  const fields = accountFields(input)
  const [result] = await pool.execute(
    `INSERT INTO cuenta
       (id_usuario, nombre, tipo, total, disponible, fecha_corte,
        fecha_limite_pago, pago_para_no_generar_intereses, datos_deposito)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, fields.name, fields.type, fields.total, fields.available,
      fields.statementDate, fields.paymentDueDate, fields.paymentToAvoidInterest, fields.depositDetails,
    ],
  )

  return { id: result.insertId }
}

export async function updateAccount(userId, id, input) {
  const fields = accountFields(input)
  const [result] = await pool.execute(
    `UPDATE cuenta
     SET nombre = ?, tipo = ?, total = ?, disponible = ?, fecha_corte = ?,
         fecha_limite_pago = ?, pago_para_no_generar_intereses = ?, datos_deposito = ?
     WHERE id = ? AND id_usuario = ?`,
    [
      fields.name, fields.type, fields.total, fields.available, fields.statementDate,
      fields.paymentDueDate, fields.paymentToAvoidInterest, fields.depositDetails, id, userId,
    ],
  )
  if (!result.affectedRows) {
    throw invalid('No se encontró la cuenta de tu usuario.', 404)
  }
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
       WHERE (id_usuario = ? OR id_usuario_destino = ?) AND (id_cuenta_origen = ? OR id_cuenta_destino = ?)`,
      [userId, userId, id, id],
    )
    if (Number(references[0].count) > 0) {
      throw invalid('No se puede eliminar una cuenta que tiene movimientos asociados.', 409)
    }
    const [loans] = await connection.execute(
      'SELECT id FROM prestamo WHERE id_usuario = ? AND id_cuenta = ? LIMIT 1', [userId, id],
    )
    if (loans.length) {
      throw invalid('La cuenta está configurada en un préstamo. Cambia su cuenta sugerida antes de eliminarla.', 409)
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
