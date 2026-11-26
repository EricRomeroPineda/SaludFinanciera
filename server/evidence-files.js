import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { dirname } from 'node:path'
import { userFolder, userStoragePath } from './user-storage.js'

const directory = new URL('../storage/evidence/', import.meta.url)
export const maxEvidenceBytes = 5 * 1024 * 1024
export const maxEvidenceCount = 5

function fileUrl(name) {
  const match = /^([^/]+)\/movimientos\/([a-f0-9-]{36}\.webp)$/.exec(name)
  if (match) return userStoragePath(match[1], 'movimientos', match[2])
  if (!/^[a-f0-9-]{36}\.webp$/.test(name)) throw new Error('Nombre de archivo de evidencia inválido.')
  return new URL(name, directory)
}

export async function normalizeEvidence(buffer) {
  if (!buffer.length || buffer.length > maxEvidenceBytes) {
    throw Object.assign(new Error('Cada imagen admite hasta 5 MB.'), { statusCode: 413 })
  }
  try {
    const image = sharp(buffer, { limitInputPixels: 100000000, animated: false, failOn: 'warning' })
    const metadata = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) {
      throw new Error('Unsupported image')
    }
    const scale = Math.min(1, Math.sqrt(20000000 / (metadata.width * metadata.height)))
    return await image.resize({
      width: Math.max(1, Math.floor(metadata.width * scale)),
      height: Math.max(1, Math.floor(metadata.height * scale)), fit: 'inside', withoutEnlargement: true,
    }).rotate().webp({ quality: 90 }).toBuffer()
  } catch {
    throw Object.assign(new Error('Selecciona una imagen JPG, PNG o WebP válida, sin animación y de hasta 100 megapíxeles. Las mayores de 20 megapíxeles se reducen automáticamente.'), { statusCode: 400 })
  }
}

export async function writeEvidence(buffer, owner) {
  const filename = `${randomUUID()}.webp`
  const name = owner ? `${userFolder(owner.id, owner.email)}/movimientos/${filename}` : filename
  if (name.length > 500) throw Object.assign(new Error('El correo es demasiado largo para la carpeta de movimientos.'), { statusCode: 400 })
  try {
    await mkdir(owner ? dirname(fileUrl(name)) : directory, { recursive: true, mode: 0o700 })
    await writeFile(fileUrl(name), buffer, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') await removeEvidenceFiles([name])
    console.error('[EVIDENCIA] No se pudo guardar la imagen:', error.code || error.name)
    throw Object.assign(new Error('No se pudo guardar la imagen. Revisa la carpeta del servidor y sus permisos.'), { statusCode: 503 })
  }
  return name
}

export function readEvidence(name) {
  return readFile(fileUrl(name))
}

export async function promoteMovementImages(connection, userId) {
  const [users] = await connection.execute('SELECT correo FROM usuario WHERE id = ?', [userId])
  const email = users[0]?.correo
  if (!email) return []
  const [images] = await connection.execute(
    `SELECT e.id, e.archivo FROM movimiento_evidencia e
     INNER JOIN movimiento m ON m.id = e.id_movimiento WHERE m.id_usuario = ? FOR UPDATE`, [userId],
  )
  const moved = []
  try {
    for (const image of images) {
      if (image.archivo.startsWith(`${userFolder(userId, email)}/movimientos/`)) continue
      const next = await writeEvidence(await readEvidence(image.archivo), { id: userId, email })
      moved.push({ old: image.archivo, next })
      await connection.execute('UPDATE movimiento_evidencia SET archivo = ? WHERE id = ?', [next, image.id])
    }
    return moved
  } catch (error) {
    await removeEvidenceFiles(moved.map((image) => image.next))
    throw error
  }
}

export async function removeEvidenceFiles(names) {
  for (const name of names) {
    try {
      await unlink(fileUrl(name))
    } catch (error) {
      // The database mutation is already committed; report cleanup failures explicitly.
      if (error.code !== 'ENOENT') console.error(`[EVIDENCIA] No se pudo borrar el archivo ${name}: ${error.code || error.message}`)
    }
  }
}
