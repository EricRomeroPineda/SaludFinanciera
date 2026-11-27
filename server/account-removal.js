import bcrypt from 'bcryptjs'
import { pool } from './db.js'
import { clearSessionCookie } from './auth.js'
import { protectedAdminId } from '../shared/user-roles.js'
import { requireAdministrator } from './user-roles.js'
import { removeEvidenceFiles } from './evidence-files.js'
import { removeProfilePhoto } from './profile-photo.js'

const invalid = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })

export async function cleanPendingAccountFiles() {
  let lastId = 0
  for (;;) {
    const [files] = await pool.execute(
      'SELECT id, tipo, referencia FROM archivo_borrado_pendiente WHERE id > ? ORDER BY id LIMIT 100', [lastId],
    )
    for (const file of files) {
      const removed = file.tipo === 'perfil' ? await removeProfilePhoto(file.referencia)
        : (await removeEvidenceFiles([file.referencia])).length === 0
      if (removed) await pool.execute('DELETE FROM archivo_borrado_pendiente WHERE id = ?', [file.id])
      lastId = file.id
    }
    if (files.length < 100) break
  }
  const [pending] = await pool.execute('SELECT COUNT(*) AS count FROM archivo_borrado_pendiente')
  return Number(pending[0].count)
}

export async function removeAccountInformation(actorId, targetId, input, deleteAccount = false) {
  if (input.confirm !== true || (deleteAccount && input.confirmPermanent !== true)) {
    throw invalid('Confirma las consecuencias antes de continuar.')
  }
  if (deleteAccount && targetId === protectedAdminId) throw invalid('El administrador ID 2 no se puede eliminar.', 403)
  if (typeof input.password !== 'string' || !input.password || Buffer.byteLength(input.password) > 72) {
    throw invalid('Escribe tu contraseña actual para confirmar.')
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [users] = await connection.execute(
      'SELECT id, password_hash, rol, foto_perfil FROM usuario WHERE id IN (?, ?) ORDER BY id FOR UPDATE', [actorId, targetId],
    )
    const actor = users.find((user) => Number(user.id) === actorId)
    const target = users.find((user) => Number(user.id) === targetId)
    if (!actor || (actorId !== targetId && actor.rol !== 'admin')) throw invalid('No tienes permiso para eliminar este usuario.', 403)
    if (!target) throw invalid('No se encontró el usuario.', 404)
    if (!await bcrypt.compare(input.password, actor.password_hash)) throw invalid('La contraseña actual es incorrecta.', 403)

    const [evidence] = await connection.execute(
      `SELECT e.archivo FROM movimiento_evidencia e
       INNER JOIN movimiento m ON m.id = e.id_movimiento WHERE m.id_usuario = ? FOR UPDATE`, [targetId],
    )
    for (const file of evidence) {
      await connection.execute("INSERT INTO archivo_borrado_pendiente (tipo, referencia) VALUES ('evidencia', ?)", [file.archivo])
    }
    if (deleteAccount && target.foto_perfil?.startsWith(`/api/profile-photo/${targetId}/`)) {
      await connection.execute("INSERT INTO archivo_borrado_pendiente (tipo, referencia) VALUES ('perfil', ?)", [target.foto_perfil])
    }
    await connection.execute(
      'DELETE e FROM movimiento_evidencia e INNER JOIN movimiento m ON m.id = e.id_movimiento WHERE m.id_usuario = ?', [targetId],
    )
    // Keep only the surviving participant's side; do not reverse any real balance.
    await connection.execute(
      `UPDATE movimiento SET id_usuario = id_usuario_destino, id_cuenta_origen = NULL,
         id_usuario_destino = NULL, archivo_familiar = 'recibida'
       WHERE id_usuario = ? AND id_usuario_destino IS NOT NULL`, [targetId],
    )
    await connection.execute(
      `UPDATE movimiento SET id_cuenta_destino = NULL, id_usuario_destino = NULL, archivo_familiar = 'enviada'
       WHERE id_usuario_destino = ?`, [targetId],
    )
    await connection.execute('DELETE FROM movimiento WHERE id_usuario = ?', [targetId])
    await connection.execute('DELETE FROM prestamo WHERE id_usuario = ?', [targetId])
    await connection.execute('DELETE FROM plan_futuro WHERE id_usuario = ?', [targetId])
    await connection.execute('DELETE FROM suscripciones WHERE id_usuario = ?', [targetId])
    await connection.execute('DELETE FROM cuenta WHERE id_usuario = ?', [targetId])
    await connection.execute('DELETE FROM familia WHERE id_creador = ?', [targetId])
    await connection.execute('DELETE FROM familia_integrante WHERE id_usuario = ?', [targetId])
    await connection.execute('DELETE FROM usuario_enlace_correo WHERE id_usuario = ?', [targetId])
    if (deleteAccount) await connection.execute('DELETE FROM usuario WHERE id = ?', [targetId])
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      console.error('[BORRADO] Relación pendiente al borrar usuario:', error.sqlMessage || error.code)
      throw invalid('No se borró nada: existen datos relacionados que impiden completar la operación. El administrador debe revisar las relaciones de la base de datos.', 409)
    }
    throw error
  } finally { connection.release() }
  let warning = ''
  try {
    if (await cleanPendingAccountFiles()) warning = 'Los datos se borraron, pero quedan archivos pendientes de limpieza. El administrador debe revisar el disco y sus permisos.'
  } catch (error) {
    console.error('[BORRADO] Limpieza de archivos pendiente:', error.code || error.message)
    warning = 'Los datos se borraron, pero la limpieza de archivos quedó pendiente. El administrador debe revisar los registros del servicio.'
  }
  return { ok: true, deleted: deleteAccount, warning }
}

export async function handleAccountRemovalRoute(request, response, url, { getUserId, readJson, sendJson }) {
  const clear = url.pathname === '/api/auth/clear-data' && request.method === 'POST'
  const own = url.pathname === '/api/auth/account' && request.method === 'DELETE'
  const admin = request.method === 'DELETE' && /^\/api\/admin\/users\/([1-9]\d*)$/.exec(url.pathname)
  if (!clear && !own && !admin) return false
  const userId = await getUserId(request, response)
  if (!userId) return true
  if (admin) await requireAdministrator(userId)
  const targetId = admin ? Number(admin[1]) : userId
  if (!Number.isSafeInteger(targetId)) throw invalid('Usuario no válido.')
  const result = await removeAccountInformation(userId, targetId, await readJson(request), !clear)
  if (!clear && userId === targetId) clearSessionCookie(response)
  sendJson(response, 200, result)
  return true
}
