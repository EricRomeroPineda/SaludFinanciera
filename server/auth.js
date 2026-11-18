import { createHmac, timingSafeEqual, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { pool } from './db.js'
import { isValidPhoto, themes } from '../shared/profile.js'

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

export function createSession(userId, version = 0) {
  const payload = Buffer.from(JSON.stringify({
    userId,
    version,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  })).toString('base64url')

  return `${payload}.${sign(payload)}`
}

export async function getSessionUserId(request) {
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

  let session
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!(session &&
      Number.isSafeInteger(session.userId) &&
      session.userId > 0 &&
      session.expiresAt > Math.floor(Date.now() / 1000))) return null
  const [users] = await pool.execute('SELECT session_version FROM usuario WHERE id = ?', [session.userId])
  return users.length === 1 && users[0].session_version === (session.version ?? 0) ? session.userId : null
}

export function setSessionCookie(response, userId, version = 0) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(createSession(userId, version))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}${secure}`,
  )
}

export function clearSessionCookie(response) {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  )
}

function invalidInput(message) {
  const error = new Error(message)
  error.statusCode = 400
  throw error
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || Buffer.byteLength(password) > 72) {
    invalidInput('La contraseña debe tener al menos 10 caracteres y no exceder 72 bytes.')
  }
}

function normalizeRecoveryKey(value) {
  if (typeof value !== 'string') invalidInput('Escribe tu palabra clave de recuperación.')
  const normalized = value.trim().normalize('NFC').toLocaleLowerCase('es')
  if (normalized.length < 4 || Buffer.byteLength(normalized) > 72) {
    invalidInput('La palabra clave debe tener al menos 4 caracteres y no exceder 72 bytes.')
  }
  return normalized
}

function validateProfile(photo, theme) {
  if (!isValidPhoto(photo)) invalidInput('Selecciona una foto JPG, PNG o WebP de hasta 256 KB, o una URL HTTPS válida.')
  validateTheme(theme)
}

function validateTheme(theme) {
  if (!themes.some(({ id }) => id === theme)) invalidInput('Selecciona uno de los cuatro temas disponibles.')
}

export async function registerUser(name, password, photo, recoveryKey, theme = 'verde') {
  const normalizedName = String(name || '').trim()
  const normalizedPassword = String(password || '')

  if (!normalizedName || normalizedName.length > 100) {
    const error = new Error('El nombre es obligatorio y no debe exceder 100 caracteres.')
    error.statusCode = 400
    throw error
  }
  validatePassword(normalizedPassword)
  validateProfile(photo, theme)
  const normalizedKey = normalizeRecoveryKey(recoveryKey)

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
    const recoveryHash = await bcrypt.hash(normalizedKey, 12)
    const [result] = await connection.execute(
      'INSERT INTO usuario (nombre, password_hash, foto_perfil, tema, recovery_key_hash) VALUES (?, ?, ?, ?, ?)',
      [normalizedName, passwordHash, photo, theme, recoveryHash],
    )

    return { id: result.insertId, name: normalizedName, photo, theme, sessionVersion: 0 }
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
    'SELECT id, nombre, password_hash, foto_perfil, tema, session_version FROM usuario WHERE nombre = ? LIMIT 2',
    [normalizedName],
  )
  if (users.length !== 1 || !await bcrypt.compare(normalizedPassword, users[0].password_hash)) {
    const error = new Error('Usuario o contraseña incorrectos.')
    error.statusCode = 401
    throw error
  }

  const { id, nombre, foto_perfil: photo, tema: theme, session_version: sessionVersion } = users[0]
  return { id, name: nombre, photo, theme, sessionVersion }
}

export async function findSessionUser(userId) {
  const [users] = await pool.execute(
    'SELECT id, nombre AS name, foto_perfil AS photo, tema AS theme, recovery_key_hash IS NOT NULL AS hasRecoveryKey FROM usuario WHERE id = ?',
    [userId],
  )
  return users[0] || null
}

export async function updateProfile(userId, { photo, theme, recoveryKey, currentPassword }) {
  validateProfile(photo, theme)
  let recoveryHash = null
  if (recoveryKey) {
    const normalizedKey = normalizeRecoveryKey(recoveryKey)
    const [users] = await pool.execute('SELECT password_hash FROM usuario WHERE id = ?', [userId])
    if (typeof currentPassword !== 'string' || !users.length || !await bcrypt.compare(currentPassword, users[0].password_hash)) {
      invalidInput('Escribe tu contraseña actual para guardar la palabra clave.')
    }
    recoveryHash = await bcrypt.hash(normalizedKey, 12)
  }
  await pool.execute(
    'UPDATE usuario SET foto_perfil = ?, tema = ?, recovery_key_hash = COALESCE(?, recovery_key_hash) WHERE id = ?',
    [photo, theme, recoveryHash, userId],
  )
  return findSessionUser(userId)
}

export async function updateTheme(userId, theme) {
  validateTheme(theme)
  await pool.execute('UPDATE usuario SET tema = ? WHERE id = ?', [theme, userId])
  return findSessionUser(userId)
}

const recoveryAttempts = new Map()
const recoveryWindowMs = 15 * 60 * 1000

function limitRecovery(key, limit) {
  const now = Date.now()
  for (const [entry, value] of recoveryAttempts) {
    if (value.expires <= now) recoveryAttempts.delete(entry)
  }
  const attempt = recoveryAttempts.get(key) || { count: 0, expires: now + recoveryWindowMs }
  if (attempt.count >= limit || (!recoveryAttempts.has(key) && recoveryAttempts.size >= 10000)) {
    const error = new Error('Demasiados intentos de recuperación. Intenta de nuevo en 15 minutos.')
    error.statusCode = 429
    throw error
  }
  attempt.count += 1
  recoveryAttempts.set(key, attempt)
}

const dummyRecoveryHash = bcrypt.hashSync('unused-recovery-key', 12)

export async function recoverPassword(name, recoveryKey, password, address) {
  limitRecovery(`ip:${address}`, 10)
  const normalizedName = String(name || '').trim()
  if (!normalizedName || normalizedName.length > 100) invalidInput('Escribe tu nombre de usuario.')
  limitRecovery(`user:${createHash('sha256').update(normalizedName.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()).digest('hex')}`, 5)
  const normalizedKey = normalizeRecoveryKey(recoveryKey)
  validatePassword(password)
  const [users] = await pool.execute(
    'SELECT id, recovery_key_hash, password_hash FROM usuario WHERE nombre = ? LIMIT 2',
    [normalizedName],
  )
  const user = users.length === 1 ? users[0] : null
  const matches = await bcrypt.compare(normalizedKey, user?.recovery_key_hash || dummyRecoveryHash)
  if (!user?.recovery_key_hash || !matches) invalidInput('El usuario o la palabra clave no son correctos.')
  const passwordHash = await bcrypt.hash(password, 12)
  const [result] = await pool.execute(
    'UPDATE usuario SET password_hash = ?, session_version = session_version + 1 WHERE id = ? AND password_hash = ? AND recovery_key_hash = ?',
    [passwordHash, user.id, user.password_hash, user.recovery_key_hash],
  )
  if (result.affectedRows !== 1) invalidInput('No fue posible restablecer la contraseña. Intenta de nuevo.')
}
