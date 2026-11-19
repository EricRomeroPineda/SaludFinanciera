import { invalid } from './validation.js'

export function cents(value) {
  const [whole, fraction = ''] = String(value).split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}

export async function lockLoans(connection, userId, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(Number))].sort((a, b) => a - b)
  if (!unique.length) return new Map()
  const [rows] = await connection.execute(
    `SELECT id, tipo, monto, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS startDate
     FROM prestamo WHERE id_usuario = ? AND id IN (${unique.map(() => '?').join(', ')})
     ORDER BY id FOR UPDATE`, [userId, ...unique],
  )
  if (rows.length !== unique.length) throw invalid('El préstamo no pertenece a tu usuario.', 404)
  return new Map(rows.map((row) => [Number(row.id), row]))
}

export async function validateLoanMovement(connection, userId, movement, loans, movementId, allowDisbursement) {
  if (!movement.loanId) {
    if (movement.loanKind) throw invalid('Selecciona el préstamo del movimiento.')
    return
  }
  const loan = loans.get(movement.loanId)
  if (!loan) throw invalid('El préstamo no pertenece a tu usuario.', 404)
  if (movement.planId || movement.subscriptionId || movement.categoryId) {
    throw invalid('Un préstamo no puede vincularse a una categoría, plan o suscripción.')
  }
  if (!['abono', 'desembolso'].includes(movement.loanKind)) throw invalid('Selecciona una clase de movimiento de préstamo válida.')
  const disbursement = movement.loanKind === 'desembolso'
  if (disbursement && !allowDisbursement) {
    throw invalid('El desembolso solo se registra al crear un préstamo nuevo.')
  }
  const expected = (loan.tipo === 'me_deben') === disbursement ? 'expense' : 'income'
  if (movement.operation !== expected) {
    throw invalid(expected === 'income' ? 'Este movimiento de préstamo requiere una cuenta de destino (ingreso).' : 'Este movimiento de préstamo requiere una cuenta de origen (salida).')
  }
  if (!movement.date || movement.date.slice(0, 10) < loan.startDate) {
    throw invalid('La fecha del movimiento no puede ser anterior al inicio del préstamo.')
  }
  if (disbursement) {
    if (cents(movement.amount) !== cents(loan.monto)) throw invalid('El desembolso debe coincidir con el monto del préstamo.')
    return
  }
  const [rows] = await connection.execute(
    `SELECT COALESCE(SUM(monto), 0) AS paid FROM movimiento
     WHERE id_usuario = ? AND id_prestamo = ? AND clase_prestamo = 'abono' AND id <> ?`,
    [userId, movement.loanId, movementId || 0],
  )
  if (cents(rows[0].paid) + cents(movement.amount) > cents(loan.monto)) {
    throw invalid('El abono supera el saldo pendiente del préstamo.', 409)
  }
}
