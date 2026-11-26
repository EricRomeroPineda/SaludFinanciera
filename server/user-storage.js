import { resolve, join } from 'node:path'

export function userFolder(userId, email) {
  return email ? encodeURIComponent(email.toLowerCase()).replace(/%40/g, '@') : `usuario-${userId}`
}

export function userStoragePath(folder, section, filename) {
  if (!/^[a-z0-9@._+%!-]+$/i.test(folder) || ['.', '..'].includes(folder)
    || !['perfil', 'movimientos'].includes(section) || !/^[a-f0-9-]{36}\.webp$/.test(filename)) {
    throw new Error('Ruta de imagen de usuario inválida.')
  }
  return join(resolve(process.env.PROFILE_PHOTO_DIR || 'storage/profile-photos'), folder, section, filename)
}
