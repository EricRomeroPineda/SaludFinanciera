import { constants } from 'node:fs'
import { access, lstat, open, readdir, realpath, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { normalizeEvidence, maxEvidenceBytes } from './evidence-files.js'

export const defaultCardImageDirectory = '/run/media/lenovoserver/discoDuro/Servidor/Admin/seguro de vida'
const defaultMount = '/run/media/lenovoserver/discoDuro'
export const catalogFilePattern = /^[a-f0-9-]{36}\.webp$/
const sourcePattern = /^[^/\\\u0000-\u001f]{1,220}\.(?:jpe?g|png|webp)$/i
const unavailable = () => Object.assign(new Error('No se puede acceder a CARD_IMAGE_DIR. Comprueba que el disco esté montado y que el usuario del servicio apps tenga permisos de lectura y escritura en la carpeta configurada.'), { statusCode: 503, expose: true })

export async function catalogDirectory(write = false) {
  const directory = path.resolve(process.env.CARD_IMAGE_DIR || defaultCardImageDirectory)
  try {
    if (process.platform === 'linux' && directory.startsWith(`${defaultMount}/`)) {
      const mounts = await readFile('/proc/self/mountinfo', 'utf8')
      if (!mounts.split('\n').some((line) => line.split(' ')[4] === defaultMount)) throw unavailable()
    }
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw unavailable()
    await access(directory, constants.R_OK | constants.X_OK | (write ? constants.W_OK : 0))
    return await realpath(directory)
  } catch (error) {
    console.error('[CATALOGO] Carpeta no disponible:', error.code || error.message)
    throw unavailable()
  }
}

async function sourceFile(name) {
  if (typeof name !== 'string' || !sourcePattern.test(name) || name.startsWith('.')) {
    throw Object.assign(new Error('Selecciona un archivo JPG, PNG o WebP de la carpeta configurada.'), { statusCode: 400 })
  }
  const directory = await catalogDirectory()
  const filename = path.join(directory, name)
  let file
  try {
    file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > maxEvidenceBytes) throw Object.assign(new Error('La imagen debe ser un archivo de hasta 5 MB.'), { statusCode: 400 })
    const buffer = Buffer.alloc(stat.size + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > maxEvidenceBytes) throw Object.assign(new Error('La imagen supera 5 MB.'), { statusCode: 413 })
    return buffer.subarray(0, bytesRead)
  } catch (error) {
    if (error.statusCode) throw error
    console.error('[CATALOGO] No se pudo leer imagen:', error.code || error.message)
    throw Object.assign(new Error('No se pudo leer la imagen seleccionada. No se admiten enlaces simbólicos; revisa el archivo y sus permisos.'), { statusCode: 400 })
  } finally {
    await file?.close()
  }
}

export async function catalogImageBuffer(buffer) {
  const normalized = await normalizeEvidence(buffer)
  return sharp(normalized).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer()
}

export async function readCatalogSource(name) {
  return catalogImageBuffer(await sourceFile(name))
}

export async function listCatalogFiles() {
  const directory = await catalogDirectory(true)
  const entries = await readdir(directory, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && sourcePattern.test(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => entry.name).sort((a, b) => a.localeCompare(b))
}

export async function writeCatalogImage(buffer) {
  const directory = await catalogDirectory(true)
  const filename = `${randomUUID()}.webp`
  try {
    await writeFile(path.join(directory, filename), buffer, { flag: 'wx', mode: 0o640 })
    return filename
  } catch (error) {
    console.error('[CATALOGO] No se pudo guardar imagen:', error.code || error.message)
    throw unavailable()
  }
}

export async function readCatalogImage(filename) {
  if (!catalogFilePattern.test(filename)) throw Object.assign(new Error('Referencia de imagen inválida.'), { statusCode: 404 })
  return sourceFile(filename)
}
