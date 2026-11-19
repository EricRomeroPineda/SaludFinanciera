import { pool } from '../../server/db.js'
import { lockSubscriptions, syncMonetized } from '../suscripciones/service.js'
import { lockPlans, syncPlanSavings } from './modules.js'

function invalid(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function normalizeId(value, label) {
  if (value === '' || value == null) return null
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw invalid(`${label} no es válido.`)
  return id
}

export async function getRelatedMovements(userId, relation, value) {
  if (!['account', 'subscription'].includes(relation)) {
    throw invalid('La relación de movimientos no es válida.')
  }
  const id = normalizeId(value, 'El identificador')
  if (!id) throw invalid('El identificador es obligatorio.')
  const condition = relation === 'account'
    ? '(m.id_cuenta_origen = ? OR m.id_cuenta_destino = ?)'
    : 'm.id_suscripcion = ?'
  const [movements] = await pool.execute(
    `SELECT m.id, m.monto AS amount,
            DATE_FORMAT(m.fecha, '%Y-%m-%d') AS date,
            cat.nombre AS category,
            origin.nombre AS originAccount, destination.nombre AS destinationAccount,
            sub.nombre AS subscriptionName,
            m.id_cuenta_origen AS originAccountId,
            m.id_cuenta_destino AS destinationAccountId
     FROM movimiento AS m
     LEFT JOIN categorias AS cat ON cat.id = m.id_categoria
     LEFT JOIN cuenta AS origin
       ON origin.id = m.id_cuenta_origen AND origin.id_usuario = m.id_usuario
     LEFT JOIN cuenta AS destination
       ON destination.id = m.id_cuenta_destino AND destination.id_usuario = m.id_usuario
     LEFT JOIN suscripciones AS sub
       ON sub.id = m.id_suscripcion AND sub.id_usuario = m.id_usuario
     WHERE m.id_usuario = ? AND ${condition}
     ORDER BY m.fecha DESC, m.id DESC`,
    relation === 'account' ? [userId, id, id] : [userId, id],
  )
  return { movements }
}

function normalizeAmount(value) {
  const text = String(value ?? '').trim()
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) {
    throw invalid('El monto debe ser positivo y tener hasta dos decimales.')
  }

  const [whole, fraction = ''] = text.split('.')
  const amount = `${BigInt(whole)}.${fraction.padEnd(2, '0')}`
  if (Number(amount) <= 0) throw invalid('El monto debe ser mayor que cero.')
  return amount
}

function normalizeDate(value) {
  if (value === '' || value == null) return null
  const text = String(value).trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) throw invalid('La fecha debe tener formato AAAA-MM-DD.')
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    throw invalid('La fecha no existe.')
  }
  return `${text} 00:00:00`
}

async function lockAndValidateReferences(connection, userId, movement) {
  const { operation, amount, originId, destinationId, categoryId, planId, subscriptionId } = movement
  if (!['expense', 'income', 'transfer'].includes(operation)) {
    throw invalid('Selecciona un tipo de operación válido.')
  }
  if (operation === 'expense' && (!originId || destinationId)) {
    throw invalid('Un gasto requiere únicamente una cuenta de origen.')
  }
  if (operation === 'income' && (!destinationId || originId)) {
    throw invalid('Un ingreso requiere únicamente una cuenta de destino.')
  }
  if (operation === 'transfer' && (!originId || !destinationId || originId === destinationId)) {
    throw invalid('Una transferencia requiere dos cuentas distintas.')
  }
  if (operation !== 'expense' && planId) {
    throw invalid('Una aportación a un plan debe registrarse como gasto desde una cuenta.')
  }
  if (operation === 'transfer' && categoryId) {
    throw invalid('Una transferencia no debe llevar categoría de ingreso o gasto.')
  }

  const accountIds = [...new Set([originId, destinationId].filter(Boolean))].sort((a, b) => a - b)
  const accountById = new Map()
  if (accountIds.length) {
    const placeholders = accountIds.map(() => '?').join(', ')
    const [accounts] = await connection.execute(
      `SELECT id, disponible FROM cuenta
       WHERE id_usuario = ? AND id IN (${placeholders})
       ORDER BY id FOR UPDATE`,
      [userId, ...accountIds],
    )
    for (const account of accounts) accountById.set(Number(account.id), account)
    if (accountById.size !== accountIds.length) {
      throw invalid('Una de las cuentas no pertenece a tu usuario.', 404)
    }
  }

  if (categoryId) {
    const [categories] = await connection.execute(
      'SELECT tipo FROM categorias WHERE id = ?',
      [categoryId],
    )
    if (!categories.length) throw invalid('La categoría no existe.', 404)
    const expectedType = operation === 'income' ? 'ingreso' : 'gasto'
    if (categories[0].tipo !== expectedType) {
      throw invalid('La categoría no corresponde al tipo de operación.')
    }
  }

  if (planId) {
    const [plans] = await connection.execute(
      'SELECT id FROM plan_futuro WHERE id = ? AND id_usuario = ? FOR UPDATE',
      [planId, userId],
    )
    if (!plans.length) throw invalid('El plan no pertenece a tu usuario.', 404)
  }

  if (subscriptionId) {
    const [subscriptions] = await connection.execute(
      'SELECT id FROM suscripciones WHERE id = ? AND id_usuario = ? FOR UPDATE',
      [subscriptionId, userId],
    )
    if (!subscriptions.length) throw invalid('La suscripción no pertenece a tu usuario.', 404)
  }

  if (originId && Number(accountById.get(originId).disponible) < Number(amount)) {
    throw invalid('La cuenta de origen no tiene saldo disponible suficiente.', 409)
  }
}

async function adjustBalance(connection, userId, accountId, amount, direction) {
  const operator = direction === 'add' ? '+' : '-'
  const condition = direction === 'subtract' ? ' AND disponible >= ?' : ''
  const params = direction === 'subtract'
    ? [amount, accountId, userId, amount]
    : [amount, accountId, userId]
  const [result] = await connection.execute(
    `UPDATE cuenta SET disponible = disponible ${operator} ?
     WHERE id = ? AND id_usuario = ?${condition}`,
    params,
  )
  if (result.affectedRows !== 1) {
    throw invalid('El saldo de la cuenta cambió o no es suficiente para esta operación.', 409)
  }
}

async function reverseMovement(connection, userId, oldMovement) {
  const amount = String(oldMovement.monto)
  if (oldMovement.id_cuenta_origen) {
    await adjustBalance(connection, userId, oldMovement.id_cuenta_origen, amount, 'add')
  }
  if (oldMovement.id_cuenta_destino) {
    await adjustBalance(connection, userId, oldMovement.id_cuenta_destino, amount, 'subtract')
  }
}

async function applyMovement(connection, userId, movement) {
  await lockAndValidateReferences(connection, userId, movement)

  if (movement.originId) {
    await adjustBalance(connection, userId, movement.originId, movement.amount, 'subtract')
  }
  if (movement.destinationId) {
    await adjustBalance(connection, userId, movement.destinationId, movement.amount, 'add')
  }
}

function parseMovement(input) {
  return {
    operation: String(input.operation || ''),
    amount: normalizeAmount(input.amount),
    date: normalizeDate(input.date),
    originId: normalizeId(input.originAccountId, 'La cuenta de origen'),
    destinationId: normalizeId(input.destinationAccountId, 'La cuenta de destino'),
    categoryId: normalizeId(input.categoryId, 'La categoría'),
    planId: normalizeId(input.planId, 'El plan'),
    subscriptionId: normalizeId(input.subscriptionId, 'La suscripción'),
  }
}

export async function saveMovement(userId, input, movementId = null) {
  const movement = parseMovement(input || {})
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    let oldSubscriptionId = null
    let oldPlanId = null

    if (movementId) {
      const [oldRows] = await connection.execute(
        'SELECT id, id_suscripcion, id_plan_futuro, id_cuenta_origen, id_cuenta_destino, monto FROM movimiento WHERE id = ? AND id_usuario = ? FOR UPDATE',
        [movementId, userId],
      )
      if (!oldRows.length) throw invalid('No se encontró el movimiento de tu usuario.', 404)
      oldSubscriptionId = oldRows[0].id_suscripcion
      oldPlanId = oldRows[0].id_plan_futuro
      await lockSubscriptions(connection, userId, [oldSubscriptionId, movement.subscriptionId])
      await lockPlans(connection, userId, [oldPlanId, movement.planId])
      await reverseMovement(connection, userId, oldRows[0])
    } else {
      await lockSubscriptions(connection, userId, [movement.subscriptionId])
      await lockPlans(connection, userId, [movement.planId])
    }

    await applyMovement(connection, userId, movement)
    const values = [
      userId,
      movement.planId,
      movement.subscriptionId,
      movement.categoryId,
      movement.originId,
      movement.destinationId,
      movement.amount,
    ]

    let id
    if (movementId) {
      await connection.execute(
        `UPDATE movimiento
         SET id_plan_futuro = ?, id_suscripcion = ?, id_categoria = ?,
             id_cuenta_origen = ?, id_cuenta_destino = ?, monto = ?,
             fecha = COALESCE(?, CURRENT_TIMESTAMP)
         WHERE id = ? AND id_usuario = ?`,
        [
          movement.planId,
          movement.subscriptionId,
          movement.categoryId,
          movement.originId,
          movement.destinationId,
          movement.amount,
          movement.date,
          movementId,
          userId,
        ],
      )
      id = movementId
    } else {
      const [result] = await connection.execute(
        `INSERT INTO movimiento
           (id_usuario, id_plan_futuro, id_suscripcion, id_categoria,
            id_cuenta_origen, id_cuenta_destino, monto, fecha)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        [...values, movement.date],
      )
      id = result.insertId
    }

    await syncMonetized(connection, userId, [oldSubscriptionId, movement.subscriptionId])
    await syncPlanSavings(connection, userId, [oldPlanId, movement.planId])
    await connection.commit()
    return { ok: true, id }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function deleteMovement(userId, movementId) {
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      'SELECT id, id_suscripcion, id_plan_futuro, id_cuenta_origen, id_cuenta_destino, monto FROM movimiento WHERE id = ? AND id_usuario = ? FOR UPDATE',
      [movementId, userId],
    )
    if (!rows.length) throw invalid('No se encontró el movimiento de tu usuario.', 404)

    await lockSubscriptions(connection, userId, [rows[0].id_suscripcion])
    await lockPlans(connection, userId, [rows[0].id_plan_futuro])
    await reverseMovement(connection, userId, rows[0])
    await connection.execute(
      'DELETE FROM movimiento WHERE id = ? AND id_usuario = ?',
      [movementId, userId],
    )
    await syncMonetized(connection, userId, [rows[0].id_suscripcion])
    await syncPlanSavings(connection, userId, [rows[0].id_plan_futuro])
    await connection.commit()
    return { ok: true, id: movementId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
