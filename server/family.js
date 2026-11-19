import { createHash, randomBytes } from 'node:crypto'
import { pool } from './db.js'

function invalid(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}

function familyName(value) {
  const name = String(value || '').trim()
  if (!name || name.length > 100) throw invalid('El nombre de la familia es obligatorio y admite hasta 100 caracteres.')
  return name
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

export async function getFamily(userId) {
  const [families] = await pool.execute(
    `SELECT f.id, f.nombre AS name, f.id_creador AS creatorId
     FROM familia f INNER JOIN familia_integrante i ON i.id_familia = f.id
     WHERE i.id_usuario = ?`, [userId],
  )
  if (!families.length) return { family: null }
  const family = families[0]
  const [members] = await pool.execute(
    `SELECT u.id, u.nombre AS name
     FROM familia_integrante i INNER JOIN usuario u ON u.id = i.id_usuario
     WHERE i.id_familia = ? ORDER BY u.nombre, u.id`, [family.id],
  )
  return { family: { ...family, members, isOwner: Number(family.creatorId) === Number(userId) } }
}

async function ownedFamily(connection, userId) {
  const [rows] = await connection.execute(
    'SELECT id FROM familia WHERE id_creador = ? FOR UPDATE', [userId],
  )
  if (!rows.length) throw invalid('Solo quien creó la familia puede realizar esta acción.', 403)
  return rows[0].id
}

async function ensureUnlinked(connection, userId) {
  await connection.execute('SELECT id FROM usuario WHERE id = ? FOR UPDATE', [userId])
  const [rows] = await connection.execute(
    'SELECT id_familia FROM familia_integrante WHERE id_usuario = ? FOR UPDATE', [userId],
  )
  if (rows.length) throw invalid('Ya perteneces a una familia. Sal de ella antes de crear o aceptar otra.', 409)
}

export async function createFamily(userId, input) {
  const name = familyName(input.name)
  return transaction(async (connection) => {
    await ensureUnlinked(connection, userId)
    const [result] = await connection.execute(
      'INSERT INTO familia (nombre, id_creador) VALUES (?, ?)', [name, userId],
    )
    await connection.execute(
      'INSERT INTO familia_integrante (id_familia, id_usuario) VALUES (?, ?)', [result.insertId, userId],
    )
    return { ok: true }
  })
}

export async function renameFamily(userId, input) {
  const name = familyName(input.name)
  return transaction(async (connection) => {
    const id = await ownedFamily(connection, userId)
    await connection.execute('UPDATE familia SET nombre = ? WHERE id = ?', [name, id])
    return { ok: true }
  })
}

export async function inviteFamily(userId) {
  return transaction(async (connection) => {
    const id = await ownedFamily(connection, userId)
    const code = randomBytes(32).toString('base64url')
    const hash = createHash('sha256').update(code).digest('hex')
    await connection.execute('DELETE FROM familia_invitacion WHERE id_familia = ?', [id])
    await connection.execute(
      'INSERT INTO familia_invitacion (codigo_hash, id_familia, vence_en) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR))',
      [hash, id],
    )
    return { code, expiresInHours: 24 }
  })
}

export async function joinFamily(userId, input) {
  const code = String(input.code || '').trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw invalid('El código de invitación no es válido.')
  const hash = createHash('sha256').update(code).digest('hex')
  return transaction(async (connection) => {
    const [invitations] = await connection.execute(
      'SELECT id_familia AS id FROM familia_invitacion WHERE codigo_hash = ?', [hash],
    )
    if (!invitations.length) throw invalid('El código venció, fue utilizado o no existe.', 409)
    // Keep the same family-then-invitation lock order as invitation renewal.
    const [families] = await connection.execute(
      'SELECT id FROM familia WHERE id = ? FOR UPDATE', [invitations[0].id],
    )
    const [active] = await connection.execute(
      `SELECT id_familia FROM familia_invitacion
       WHERE codigo_hash = ? AND id_familia = ? AND vence_en > UTC_TIMESTAMP() FOR UPDATE`,
      [hash, invitations[0].id],
    )
    if (!families.length || !active.length) throw invalid('El código venció, fue utilizado o no existe.', 409)
    await ensureUnlinked(connection, userId)
    await connection.execute(
      'INSERT INTO familia_integrante (id_familia, id_usuario) VALUES (?, ?)', [families[0].id, userId],
    )
    await connection.execute('DELETE FROM familia_invitacion WHERE codigo_hash = ?', [hash])
    return { ok: true }
  })
}

export async function leaveFamily(userId) {
  return transaction(async (connection) => {
    const [owned] = await connection.execute('SELECT id FROM familia WHERE id_creador = ? FOR UPDATE', [userId])
    if (owned.length) throw invalid('Como creador, usa Disolver familia para retirar la relación de todos los integrantes.', 409)
    const [result] = await connection.execute('DELETE FROM familia_integrante WHERE id_usuario = ?', [userId])
    if (!result.affectedRows) throw invalid('No perteneces a una familia.', 404)
    return { ok: true }
  })
}

export async function removeFamilyMember(userId, memberId) {
  if (!Number.isSafeInteger(memberId) || memberId <= 0 || memberId === userId) {
    throw invalid('Selecciona otro integrante válido.')
  }
  return transaction(async (connection) => {
    const id = await ownedFamily(connection, userId)
    const [result] = await connection.execute(
      'DELETE FROM familia_integrante WHERE id_familia = ? AND id_usuario = ?', [id, memberId],
    )
    if (!result.affectedRows) throw invalid('No se encontró ese integrante en tu familia.', 404)
    return { ok: true }
  })
}

export async function dissolveFamily(userId) {
  return transaction(async (connection) => {
    const id = await ownedFamily(connection, userId)
    await connection.execute('DELETE FROM familia WHERE id = ?', [id])
    return { ok: true }
  })
}

export async function handleFamilyRoute(request, response, url, helpers) {
  if (!url.pathname.startsWith('/api/family')) return false
  const { getUserId, readJson, sendJson } = helpers
  const route = `${request.method} ${url.pathname}`
  const actions = {
    'GET /api/family': () => getFamily(userId),
    'POST /api/family': async () => createFamily(userId, await readJson(request)),
    'PUT /api/family': async () => renameFamily(userId, await readJson(request)),
    'DELETE /api/family': () => dissolveFamily(userId),
    'POST /api/family/invitations': () => inviteFamily(userId),
    'POST /api/family/join': async () => joinFamily(userId, await readJson(request)),
    'DELETE /api/family/membership': () => leaveFamily(userId),
  }
  const memberRoute = /^\/api\/family\/members\/(\d+)$/.exec(url.pathname)
  const action = actions[route] || (memberRoute && request.method === 'DELETE'
    ? () => removeFamilyMember(userId, Number(memberRoute[1])) : null)
  if (!action) return false
  const userId = await getUserId(request, response)
  if (!userId) return true
  sendJson(response, 200, await action())
  return true
}
