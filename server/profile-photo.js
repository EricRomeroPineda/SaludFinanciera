import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { pool } from './db.js'
import { normalizeEvidence } from './evidence-files.js'
import { readImage } from './evidence.js'

const invalid = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const pattern = /^\/api\/profile-photo\/([1-9]\d*)\/([^/]+)\/([a-f0-9-]{36}\.webp)$/

function location(photo) {
  const match = pattern.exec(photo || '')
  if (!match) return null
  const folder = decodeURIComponent(match[2])
  if (!/^[a-z0-9@._+%!-]+$/i.test(folder) || ['.', '..'].includes(folder)) {
    throw invalid('La carpeta de perfil no es válida.')
  }
  const root = resolve(process.env.PROFILE_PHOTO_DIR || 'storage/profile-photos')
  return { id: Number(match[1]), file: join(root, folder, 'perfil', match[3]) }
}

export async function removeProfilePhoto(photo) {
  const stored = location(photo)
  if (!stored) return
  try {
    await unlink(stored.file)
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[Perfil] No se pudo borrar la foto:', error.code || error.name)
  }
}

async function writePhoto(userId, email, buffer) {
  const folder = email ? encodeURIComponent(email.toLowerCase()).replace(/%40/g, '@') : `usuario-${userId}`
  const photo = `/api/profile-photo/${userId}/${encodeURIComponent(folder)}/${randomUUID()}.webp`
  if (photo.length > 500) throw invalid('El correo es demasiado largo para crear la carpeta de perfil.')
  const { file } = location(photo)
  await mkdir(resolve(file, '..'), { recursive: true, mode: 0o700 })
  try {
    await writeFile(file, buffer, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') await removeProfilePhoto(photo)
    throw error
  }
  return photo
}

export async function promoteProfilePhoto(connection, userId) {
  const [users] = await connection.execute(
    'SELECT foto_perfil, correo FROM usuario WHERE id = ?', [userId],
  )
  const user = users[0]
  const old = location(user?.foto_perfil)
  if (!old || old.id !== Number(userId)) return null
  const photo = await writePhoto(userId, user.correo, await readFile(old.file))
  try {
    await connection.execute('UPDATE usuario SET foto_perfil = ? WHERE id = ?', [photo, userId])
  } catch (error) {
    await removeProfilePhoto(photo)
    throw error
  }
  return { old: user.foto_perfil, photo }
}

export async function uploadProfilePhoto(userId, buffer) {
  const normalized = await normalizeEvidence(buffer)
  const image = await sharp(normalized).resize(800, 800, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
  const connection = await pool.getConnection()
  let photo
  let previous
  let committed = false
  try {
    await connection.beginTransaction()
    const [users] = await connection.execute(
      'SELECT foto_perfil, correo, correo_verificado FROM usuario WHERE id = ? FOR UPDATE', [userId],
    )
    if (!users.length) throw invalid('No se encontró el usuario.', 404)
    previous = users[0].foto_perfil
    photo = await writePhoto(userId, Number(users[0].correo_verificado) ? users[0].correo : null, image)
    await connection.execute('UPDATE usuario SET foto_perfil = ? WHERE id = ?', [photo, userId])
    await connection.commit()
    committed = true
    return photo
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
    if (photo) await removeProfilePhoto(committed ? previous : photo)
  }
}

export async function handleProfilePhotoRoute(request, response, url, { getUserId, sendJson }) {
  const upload = url.pathname === '/api/auth/photo' && request.method === 'POST'
  const match = pattern.exec(url.pathname)
  if (!upload && !(match && ['GET', 'HEAD'].includes(request.method))) return false
  const userId = await getUserId(request, response)
  if (!userId) return true
  if (upload) {
    try {
      sendJson(response, 201, { photo: await uploadProfilePhoto(userId, await readImage(request)) })
    } catch (error) {
      if (!error.statusCode) {
        console.error('[Perfil] No se pudo guardar la foto:', error.code || error.name)
        throw invalid('No se pudo guardar la foto. Revisa la carpeta del servidor y sus permisos.', 503)
      }
      throw error
    }
  } else {
    if (Number(match[1]) !== Number(userId)) throw invalid('Solo puedes consultar tu propia foto.', 403)
    const [users] = await pool.execute('SELECT foto_perfil FROM usuario WHERE id = ?', [userId])
    if (users[0]?.foto_perfil !== url.pathname) throw invalid('No se encontró la foto.', 404)
    let image
    try {
      image = await readFile(location(url.pathname).file)
    } catch (error) {
      if (error.code === 'ENOENT') throw invalid('No se encontró el archivo de la foto.', 404)
      throw error
    }
    response.writeHead(200, {
      'Content-Type': 'image/webp', 'Content-Length': image.length, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
    })
    response.end(request.method === 'HEAD' ? undefined : image)
  }
  return true
}
