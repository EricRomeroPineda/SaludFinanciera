import { createHmac, timingSafeEqual, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { pool } from './db.js'

const SESSION_COOKIE = 'salud_financiera_session'
const SESSION_DURATION_SECONDS = 60 * 60 * 24
const sessionSecret = process.env.SESSION_SECRET || ''

function requireSessionSecret() {
  if (Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.')
  }
}

function sign(value) {
  requireSessionSecret()
  return createHmac('sha256', sessionSecret).update(value).digest('base64url')
}

export function validateSessionSecret() {
  requireSessionSecret()
}

export function createSession(userId) {
  const payload = Buffer.from(JSON.stringify({
    userId,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  })).toString('base64url')

  return `${payload}.${sign(payload)}`
}

export function getSessionUserId(request) {
  const cookieHeader = request.headers.cookie || ''
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))

  if (!cookie) return null

  let token
  try {
    token = decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1))
  } catch {
    return null
  }
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null

  const expected = Buffer.from(sign(payload))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return Number.isSafeInteger(session.userId) &&
      session.userId > 0 &&
      session.expiresAt > Math.floor(Date.now() / 1000)
      ? session.userId
      : null
  } catch {
    return null
  }
}

export function setSessionCookie(response, userId) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(createSession(userId))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}${secure}`,
  )
}

export function clearSessionCookie(response) {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  )
}

export async function registerUser(name, password) {
  const normalizedName = String(name || '').trim()
  const normalizedPassword = String(password || '')

  if (!normalizedName || normalizedName.length > 100) {
    const error = new Error('El nombre es obligatorio y no debe exceder 100 caracteres.')
    error.statusCode = 400
    throw error
  }
  if (normalizedPassword.length < 10 || Buffer.byteLength(normalizedPassword) > 72) {
    const error = new Error('La contraseña debe tener entre 10 y 72 caracteres.')
    error.statusCode = 400
    throw error
  }

  const connection = await pool.getConnection()
  const lockName = `sf_register_${createHash('sha256').update(normalizedName.toLowerCase()).digest('hex').slice(0, 40)}`

  try {
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [lockName])
    if (Number(lockRows[0].acquired) !== 1) {
      const error = new Error('No fue posible iniciar el registro. Intenta de nuevo.')
      error.statusCode = 503
      throw error
    }

    const [existingUsers] = await connection.execute(
      'SELECT id FROM usuario WHERE nombre = ? LIMIT 1',
      [normalizedName],
    )
    if (existingUsers.length) {
      const error = new Error('Ya existe un usuario con ese nombre.')
      error.statusCode = 409
      throw error
    }

    const passwordHash = await bcrypt.hash(normalizedPassword, 12)
    const [result] = await connection.execute(
      'INSERT INTO usuario (nombre, password_hash) VALUES (?, ?)',
      [normalizedName, passwordHash],
    )

    return { id: result.insertId, name: normalizedName }
  } finally {
    try {
      await connection.execute('SELECT RELEASE_LOCK(?)', [lockName])
    } finally {
      connection.release()
    }
  }
}

export async function authenticateUser(name, password) {
  const normalizedName = String(name || '').trim()
  const normalizedPassword = String(password || '')
  if (!normalizedName || !normalizedPassword) {
    const error = new Error('Escribe tu nombre de usuario y contraseña.')
    error.statusCode = 400
    throw error
  }

  const [users] = await pool.execute(
    'SELECT id, nombre, password_hash, foto_perfil, tema FROM usuario WHERE nombre = ? LIMIT 2',
    [normalizedName],
  )
  if (users.length !== 1 || !await bcrypt.compare(normalizedPassword, users[0].password_hash)) {
    const error = new Error('Usuario o contraseña incorrectos.')
    error.statusCode = 401
    throw error
  }

  const { id, nombre, foto_perfil: photo, tema: theme } = users[0]
  return { id, name: nombre, photo, theme }
}

export async function findSessionUser(userId) {
  const [users] = await pool.execute(
    'SELECT id, nombre AS name, foto_perfil AS photo, tema AS theme FROM usuario WHERE id = ?',
    [userId],
  )
  return users[0] || null
}
