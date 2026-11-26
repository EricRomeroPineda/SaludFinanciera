import { resolve, join } from 'node:path'
import { mkdir } from 'node:fs/promises'

export function userFolder(userId, email) {
  return email ? encodeURIComponent(email.toLowerCase()).replace(/%40/g, '@') : `usuario-${userId}`
}

function userDirectory(folder, section) {
  if (!/^[a-z0-9@._+%!-]+$/i.test(folder) || ['.', '..'].includes(folder)
    || !['perfil', 'movimientos'].includes(section)) {
    throw new Error('Ruta de imagen de usuario inválida.')
  }
  return join(resolve(process.env.PROFILE_PHOTO_DIR || 'storage/profile-photos'), folder, section)
}

export function userStoragePath(folder, section, filename) {
  if (!/^[a-f0-9-]{36}\.webp$/.test(filename)) throw new Error('Ruta de imagen de usuario inválida.')
  return join(userDirectory(folder, section), filename)
}

export async function ensureUserStorage(folder) {
  for (const section of ['perfil', 'movimientos']) {
    await mkdir(userDirectory(folder, section), { recursive: true, mode: 0o700 })
  }
}
