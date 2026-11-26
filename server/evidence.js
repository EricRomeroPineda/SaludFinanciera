import { pool } from './db.js'
import { invalid, positiveId } from '../saludFinanciera/server/validation.js'
import {
  maxEvidenceBytes, maxEvidenceCount, normalizeEvidence, readEvidence,
  removeEvidenceFiles, writeEvidence,
} from './evidence-files.js'

async function authorize(connection, userId, movementId, write = false) {
  const [rows] = await connection.execute(
    `SELECT m.id_usuario AS ownerId FROM movimiento m
     WHERE m.id = ? AND (m.id_usuario = ?${write ? '' : ` OR EXISTS (
       SELECT 1 FROM familia_integrante viewer
       INNER JOIN familia_integrante owner ON owner.id_familia = viewer.id_familia
       WHERE viewer.id_usuario = ? AND owner.id_usuario = m.id_usuario
     )`})${write ? ' FOR UPDATE' : ''}`,
    write ? [movementId, userId] : [movementId, userId, userId],
  )
  if (!rows.length) throw invalid('No se encontró el movimiento o no tienes permiso para consultar su evidencia.', 404)
  return Number(rows[0].ownerId) === Number(userId)
}

export async function listEvidence(userId, movementId) {
  const canManage = await authorize(pool, userId, movementId)
  const [images] = await pool.execute(
    'SELECT id, nombre AS name FROM movimiento_evidencia WHERE id_movimiento = ? ORDER BY id',
    [movementId],
  )
  return { images, canManage }
}

export async function uploadEvidence(userId, movementId, buffer, originalName) {
  await authorize(pool, userId, movementId)
  const normalized = await normalizeEvidence(buffer)
  const name = String(originalName || 'Evidencia').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 150) || 'Evidencia'
  const connection = await pool.getConnection()
  let filename
  let committed = false
  try {
    await connection.beginTransaction()
    const [users] = await connection.execute(
      'SELECT correo, correo_verificado FROM usuario WHERE id = ? FOR UPDATE', [userId],
    )
    if (!users.length) throw invalid('No se encontró el usuario.', 404)
    await authorize(connection, userId, movementId, true)
    const [existing] = await connection.execute(
      'SELECT id FROM movimiento_evidencia WHERE id_movimiento = ? FOR UPDATE', [movementId],
    )
    if (existing.length >= maxEvidenceCount) throw invalid('Cada movimiento admite hasta 5 imágenes.', 409)
    filename = await writeEvidence(normalized, { id: userId, email: Number(users[0].correo_verificado) ? users[0].correo : null })
    const [result] = await connection.execute(
      'INSERT INTO movimiento_evidencia (id_movimiento, archivo, nombre) VALUES (?, ?, ?)',
      [movementId, filename, name],
    )
    await connection.commit()
    committed = true
    return { image: { id: result.insertId, name } }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
    if (filename && !committed) await removeEvidenceFiles([filename])
  }
}

export async function deleteEvidence(userId, movementId, evidenceId) {
  const connection = await pool.getConnection()
  let filename
  try {
    await connection.beginTransaction()
    await authorize(connection, userId, movementId, true)
    const [rows] = await connection.execute(
      'SELECT archivo FROM movimiento_evidencia WHERE id = ? AND id_movimiento = ? FOR UPDATE',
      [evidenceId, movementId],
    )
    if (!rows.length) throw invalid('No se encontró la imagen.', 404)
    filename = rows[0].archivo
    await connection.execute('DELETE FROM movimiento_evidencia WHERE id = ? AND id_movimiento = ?', [evidenceId, movementId])
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  await removeEvidenceFiles([filename])
  return { ok: true }
}

export async function getEvidence(userId, movementId, evidenceId) {
  await authorize(pool, userId, movementId)
  const [rows] = await pool.execute(
    'SELECT archivo FROM movimiento_evidencia WHERE id = ? AND id_movimiento = ?', [evidenceId, movementId],
  )
  if (!rows.length) throw invalid('No se encontró la imagen.', 404)
  return readEvidence(rows[0].archivo)
}

export async function readImage(request) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(request.headers['content-type']?.split(';')[0])) {
    throw invalid('Solo se admiten imágenes JPG, PNG o WebP.', 415)
  }
  if (Number(request.headers['content-length']) > maxEvidenceBytes) throw invalid('Cada imagen admite hasta 5 MB.', 413)
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > maxEvidenceBytes) throw invalid('Cada imagen admite hasta 5 MB.', 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function handleEvidenceRoute(request, response, url, { getUserId, sendJson }) {
  const match = /^\/api\/movements\/(\d+)\/evidence(?:\/(\d+))?$/.exec(url.pathname)
  if (!match) return false
  const method = request.method
  if (!['GET', 'HEAD', 'POST', 'DELETE'].includes(method) ||
      (!match[2] && ['HEAD', 'DELETE'].includes(method)) || (match[2] && method === 'POST')) return false
  const userId = await getUserId(request, response)
  if (!userId) return true
  if (url.searchParams.get('view') === 'family' && ['POST', 'DELETE'].includes(method)) {
    throw invalid('La vista familiar es de solo consulta.', 403)
  }
  const movementId = positiveId(match[1], 'El movimiento')
  const evidenceId = match[2] ? positiveId(match[2], 'La imagen') : null
  if (method === 'POST') {
    let name
    try { name = decodeURIComponent(request.headers['x-file-name'] || 'Evidencia') } catch {
      throw invalid('El nombre del archivo no es válido.')
    }
    // Check ownership before buffering or decoding an upload.
    await authorize(pool, userId, movementId, true)
    sendJson(response, 201, await uploadEvidence(userId, movementId, await readImage(request), name))
  } else if (method === 'DELETE') {
    sendJson(response, 200, await deleteEvidence(userId, movementId, evidenceId))
  } else if (evidenceId) {
    const image = await getEvidence(userId, movementId, evidenceId)
    response.writeHead(200, {
      'Content-Type': 'image/webp', 'Content-Length': image.length,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline; filename="evidencia.webp"',
      'Cross-Origin-Resource-Policy': 'same-origin',
    })
    response.end(method === 'HEAD' ? undefined : image)
  } else {
    sendJson(response, 200, await listEvidence(userId, movementId))
  }
  return true
}
