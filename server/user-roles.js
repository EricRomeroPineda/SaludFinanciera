import { pool } from './db.js'
import { protectedAdminId, userRoles } from '../shared/user-roles.js'

const invalid = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })

export async function requireAdministrator(userId) {
  const [users] = await pool.execute('SELECT rol FROM usuario WHERE id = ?', [userId])
  if (users[0]?.rol !== 'admin') throw invalid('Solo un administrador puede realizar esta operación.', 403)
}

export async function handleUserRolesRoute(request, response, url, { getUserId, readJson, sendJson }) {
  if (url.pathname !== '/api/admin/users' && !url.pathname.startsWith('/api/admin/users/')) return false
  const userId = await getUserId(request, response)
  if (!userId) return true
  await requireAdministrator(userId)
  if (url.pathname === '/api/admin/users' && request.method === 'GET') {
    const [users] = await pool.execute('SELECT id, nombre AS name, rol AS role FROM usuario ORDER BY nombre, id')
    sendJson(response, 200, { users })
    return true
  }
  const match = /^\/api\/admin\/users\/([1-9]\d*)\/role$/.exec(url.pathname)
  if (!match || request.method !== 'PUT') throw invalid('Ruta de gestión de cuentas no encontrada.', 404)
  const id = Number(match[1])
  if (!Number.isSafeInteger(id)) throw invalid('Usuario no válido.')
  const { role } = await readJson(request)
  if (!userRoles.some(([value]) => value === role)) throw invalid('Selecciona Admin, Free o VIP.')
  if (id === protectedAdminId && role !== 'admin') throw invalid('El usuario ID 2 debe conservar el rol Admin.', 403)
  const [result] = await pool.execute('UPDATE usuario SET rol = ? WHERE id = ?', [role, id])
  if (!result.affectedRows) throw invalid('No se encontró el usuario.', 404)
  sendJson(response, 200, { id, role })
  return true
}
