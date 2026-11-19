import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'

const directory = new URL('../storage/evidence/', import.meta.url)
export const maxEvidenceBytes = 5 * 1024 * 1024
export const maxEvidenceCount = 5

function fileUrl(name) {
  if (!/^[a-f0-9-]{36}\.webp$/.test(name)) throw new Error('Nombre de archivo de evidencia inválido.')
  return new URL(name, directory)
}

export async function normalizeEvidence(buffer) {
  if (!buffer.length || buffer.length > maxEvidenceBytes) {
    throw Object.assign(new Error('Cada imagen admite hasta 5 MB.'), { statusCode: 413 })
  }
  try {
    const image = sharp(buffer, { limitInputPixels: 20000000, animated: false, failOn: 'warning' })
    const metadata = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) {
      throw new Error('Unsupported image')
    }
    return await image.rotate().webp({ quality: 90 }).toBuffer()
  } catch {
    throw Object.assign(new Error('Selecciona una imagen JPG, PNG o WebP válida, sin animación y de hasta 20 megapíxeles.'), { statusCode: 400 })
  }
}

export async function writeEvidence(buffer) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const name = `${randomUUID()}.webp`
  try {
    await writeFile(fileUrl(name), buffer, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') await removeEvidenceFiles([name])
    throw error
  }
  return name
}

export function readEvidence(name) {
  return readFile(fileUrl(name))
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
