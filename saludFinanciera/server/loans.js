import { pool } from '../../server/db.js'
import { decimal, invalid, positiveId, requiredDate, requiredText } from './validation.js'
import { saveMovementInTransaction } from './movements.js'

export async function getLoans(userId) {
  const [rows] = await pool.execute(
    `SELECT p.id, p.persona AS name, p.tipo AS type, p.monto AS principal,
            DATE_FORMAT(p.fecha_inicio, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(p.fecha_compromiso, '%Y-%m-%d') AS commitmentDate,
            p.id_cuenta AS accountId, c.nombre AS accountName, p.anterior AS legacy, p.notas AS notes,
            COALESCE(a.paid, 0) AS paid, p.monto - COALESCE(a.paid, 0) AS remaining
     FROM prestamo p
     LEFT JOIN cuenta c ON c.id = p.id_cuenta AND c.id_usuario = p.id_usuario
     LEFT JOIN (
       SELECT id_prestamo, SUM(monto) AS paid FROM movimiento
       WHERE id_usuario = ? AND clase_prestamo = 'abono' GROUP BY id_prestamo
     ) a ON a.id_prestamo = p.id
     WHERE p.id_usuario = ? ORDER BY p.fecha_compromiso, p.id`, [userId, userId],
  )
  return rows
}

async function transaction(action) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await action(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

function details(input) {
  const name = requiredText(input.name, 'El nombre de la persona', 100)
  const commitmentDate = requiredDate(input.commitmentDate, 'La fecha compromiso')
  const notes = String(input.notes || '').trim()
  if (notes.length > 500) throw invalid('Las notas admiten hasta 500 caracteres.')
  return { name, commitmentDate, notes: notes || null }
}

async function validateAccount(connection, userId, value) {
  if (value === '' || value == null) return null
  const id = positiveId(value, 'La cuenta')
  const [rows] = await connection.execute('SELECT id FROM cuenta WHERE id = ? AND id_usuario = ? FOR UPDATE', [id, userId])
  if (!rows.length) throw invalid('La cuenta no pertenece a tu usuario.', 404)
  return id
}

export async function createLoan(userId, input) {
  const { name, commitmentDate, notes } = details(input)
  if (!['me_deben', 'debo'].includes(input.type)) throw invalid('Selecciona Me deben o Yo debo.')
  if (typeof input.recordDisbursement !== 'boolean') throw invalid('Indica si el préstamo es nuevo o anterior.')
  const principal = decimal(input.principal, 'El monto')
  const startDate = requiredDate(input.startDate, 'La fecha de inicio')
  if (commitmentDate < startDate) throw invalid('La fecha compromiso no puede ser anterior al inicio.')
  return transaction(async (connection) => {
    const accountId = await validateAccount(connection, userId, input.accountId)
    if (input.recordDisbursement && !accountId) throw invalid('Selecciona la cuenta de salida o destino del dinero.')
    const [result] = await connection.execute(
      `INSERT INTO prestamo (id_usuario, persona, tipo, monto, fecha_inicio, fecha_compromiso, id_cuenta, anterior, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, name, input.type, principal, startDate, commitmentDate, accountId, input.recordDisbursement ? 0 : 1, notes],
    )
    let movementId = null
    if (input.recordDisbursement) {
      const { id } = await saveMovementInTransaction(connection, userId, {
        operation: input.type === 'me_deben' ? 'expense' : 'income',
        amount: principal, date: startDate,
        originAccountId: input.type === 'me_deben' ? accountId : null,
        destinationAccountId: input.type === 'debo' ? accountId : null,
        loanId: result.insertId, loanKind: 'desembolso',
      }, null, true)
      movementId = id
    }
    return { id: result.insertId, movementId }
  })
}

export async function updateLoan(userId, id, input) {
  const { name, commitmentDate, notes } = details(input)
  return transaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS startDate
       FROM prestamo WHERE id = ? AND id_usuario = ? FOR UPDATE`, [id, userId],
    )
    if (!rows.length) throw invalid('No se encontró el préstamo de tu usuario.', 404)
    if (commitmentDate < rows[0].startDate) throw invalid('La fecha compromiso no puede ser anterior al inicio.')
    const accountId = await validateAccount(connection, userId, input.accountId)
    await connection.execute(
      'UPDATE prestamo SET persona = ?, fecha_compromiso = ?, id_cuenta = ?, notas = ? WHERE id = ? AND id_usuario = ?',
      [name, commitmentDate, accountId, notes, id, userId],
    )
    return { ok: true, id }
  })
}

export async function deleteLoan(userId, id) {
  return transaction(async (connection) => {
    const [rows] = await connection.execute('SELECT id FROM prestamo WHERE id = ? AND id_usuario = ? FOR UPDATE', [id, userId])
    if (!rows.length) throw invalid('No se encontró el préstamo de tu usuario.', 404)
    const [references] = await connection.execute('SELECT id FROM movimiento WHERE id_prestamo = ? AND id_usuario = ? LIMIT 1', [id, userId])
    if (references.length) throw invalid('No se puede eliminar un préstamo con movimientos. Se conserva su historial.', 409)
    await connection.execute('DELETE FROM prestamo WHERE id = ? AND id_usuario = ?', [id, userId])
    return { ok: true, id }
  })
}
