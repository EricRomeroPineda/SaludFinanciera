import nodemailer from 'nodemailer'
import { randomBytes, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { pool } from './db.js'
import { normalizeRecoveryKey } from './auth.js'

const invalid = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const attempts = new Map()

function limit(key) {
  const now = Date.now()
  for (const [id, value] of attempts) if (value.until <= now) attempts.delete(id)
  const value = attempts.get(key) || { count: 0, until: now + 15 * 60000 }
  if (value.count >= 5) throw invalid('Demasiados intentos. Espera 15 minutos.', 429)
  value.count++
  attempts.set(key, value)
}

export async function sendAccountEmail(to, purpose, token) {
  const base = new URL(process.env.APP_BASE_URL || '')
  if (base.protocol !== 'https:' || base.username || base.password) {
    throw new Error('APP_BASE_URL debe ser una URL HTTPS pública sin credenciales.')
  }
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD
  const from = process.env.SMTP_FROM || user
  if (!user || !pass || !from) throw new Error('Configura SMTP_USER, SMTP_PASSWORD y SMTP_FROM.')
  const link = new URL('/', base)
  link.hash = new URLSearchParams({ [purpose]: token }).toString()
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== 'false',
    auth: { user, pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  })
  try {
    const result = await transport.sendMail({
      from, to,
      subject: purpose === 'verify-email' ? 'Verifica tu correo · Salud Financiera' : 'Cambia tu palabra clave de recuperación · Salud Financiera',
      text: `Abre este enlace para ${purpose === 'verify-email' ? 'verificar tu correo' : 'crear una nueva palabra clave de recuperación'}:\n\n${link.href}\n\nCaduca en 30 minutos y solo puede usarse una vez. Si no lo solicitaste, ignora este correo. Nunca compartas el enlace.`,
    })
    if (!result.accepted?.length || result.rejected?.length) throw new Error('El servidor de correo rechazó al destinatario.')
  } finally {
    transport.close()
  }
}

export async function requestEmailLink(userId, purpose, input, send = sendAccountEmail) {
  limit(`send:${userId}`)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [users] = await connection.execute(
      'SELECT correo, correo_verificado, password_hash FROM usuario WHERE id = ? FOR UPDATE', [userId],
    )
    if (!users.length) throw invalid('No se encontró el usuario.', 404)
    const user = users[0]
    let email = user.correo
    if (purpose === 'verify-email') {
      if (Number(user.correo_verificado)) throw invalid('El correo ya está verificado y no se puede cambiar.', 409)
      email = String(input.email || '').trim().toLowerCase()
      if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw invalid('Escribe un correo electrónico válido.')
      if (typeof input.currentPassword !== 'string'
        || !await bcrypt.compare(input.currentPassword, user.password_hash)) throw invalid('La contraseña actual no es correcta.')
    } else if (purpose !== 'reset-recovery' || !email || !Number(user.correo_verificado)) {
      throw invalid('Primero registra y verifica tu correo electrónico.')
    }
    const [recent] = await connection.execute(
      `SELECT id_usuario FROM usuario_enlace_correo
       WHERE id_usuario = ? AND expira > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1770 SECOND)`,
      [userId],
    )
    if (recent.length) throw invalid('Correo enviado recientemente. Espera 30 segundos antes de volver a enviarlo.', 429)
    if (purpose === 'verify-email') {
      await connection.execute('UPDATE usuario SET correo = ?, correo_verificado = 0 WHERE id = ?', [email, userId])
      await connection.execute('DELETE FROM usuario_enlace_correo WHERE id_usuario = ?', [userId])
    }
    const token = randomBytes(32).toString('hex')
    await connection.execute(
      `INSERT INTO usuario_enlace_correo (id_usuario, proposito, token_hash, correo, expira)
       VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))
       ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), correo = VALUES(correo), expira = VALUES(expira)`,
      [userId, purpose, createHash('sha256').update(token).digest('hex'), email],
    )
    await send(email, purpose, token)
    await connection.commit()
    return { ok: true, retryAfterSeconds: 30, message: 'Correo enviado. Revisa tu bandeja de entrada y spam. Espera 30 segundos para volver a enviarlo. El enlace caduca en 30 minutos.' }
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') throw invalid('Ya hay una cuenta registrada con ese correo.', 409)
    if (!error.statusCode) {
      console.error('[Email] No se pudo enviar el enlace:', error.code || error.name)
      throw invalid('No se pudo enviar el correo. Revisa la configuración SMTP e inténtalo de nuevo.', 503)
    }
    throw error
  } finally {
    connection.release()
  }
}

export async function consumeEmailLink(purpose, input, address) {
  limit(`consume:${address}`)
  if (!['verify-email', 'reset-recovery'].includes(purpose) || !/^[a-f0-9]{64}$/.test(input.token || '')) {
    throw invalid('El enlace no es válido o ya caducó.')
  }
  let recoveryHash
  if (purpose === 'reset-recovery') {
    const key = normalizeRecoveryKey(input.recoveryKey)
    recoveryHash = await bcrypt.hash(key, 12)
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const hash = createHash('sha256').update(input.token).digest('hex')
    const [links] = await connection.execute(
      'SELECT id_usuario FROM usuario_enlace_correo WHERE token_hash = ? AND proposito = ?', [hash, purpose],
    )
    if (!links.length) throw invalid('El enlace no es válido, ya se usó o caducó.')
    const id = links[0].id_usuario
    await connection.execute('SELECT id FROM usuario WHERE id = ? FOR UPDATE', [id])
    const [valid] = await connection.execute(
      `SELECT e.id_usuario FROM usuario_enlace_correo e
       INNER JOIN usuario u ON u.id = e.id_usuario AND u.correo = e.correo
       WHERE e.token_hash = ? AND e.proposito = ? AND e.expira > UTC_TIMESTAMP()
         AND (? = 'verify-email' OR u.correo_verificado = 1) FOR UPDATE`, [hash, purpose, purpose],
    )
    if (!valid.length) throw invalid('El enlace no es válido, ya se usó o caducó.')
    if (purpose === 'verify-email') {
      await connection.execute('UPDATE usuario SET correo_verificado = 1 WHERE id = ?', [id])
    } else {
      await connection.execute(
        'UPDATE usuario SET recuperacion_token_hash = ?, recuperacion_expira = NULL WHERE id = ?', [recoveryHash, id],
      )
    }
    await connection.execute('DELETE FROM usuario_enlace_correo WHERE id_usuario = ? AND proposito = ?', [id, purpose])
    await connection.commit()
    return { ok: true }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function handleEmailRoute(request, response, url, { getUserId, readJson, sendJson }) {
  if (request.method !== 'POST') return false
  const action = {
    '/api/auth/email/send-verification': ['send', 'verify-email'],
    '/api/auth/email/send-recovery': ['send', 'reset-recovery'],
    '/api/auth/email/verify': ['consume', 'verify-email'],
    '/api/auth/email/reset-recovery': ['consume', 'reset-recovery'],
  }[url.pathname]
  if (!action) return false
  if (action[0] === 'send') {
    const id = await getUserId(request, response)
    if (!id) return true
    sendJson(response, 200, await requestEmailLink(id, action[1], await readJson(request)))
  } else {
    sendJson(response, 200, await consumeEmailLink(action[1], await readJson(request), request.socket.remoteAddress))
  }
  return true
}
