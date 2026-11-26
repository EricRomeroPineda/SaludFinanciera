import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { databaseConfig, pool } from './db.js'
import {
  authenticateUser,
  clearSessionCookie,
  findSessionUser,
  getSessionUserId,
  registerUser,
  recoverPassword,
  updateProfile,
  updateTheme,
  setSessionCookie,
  validateSessionSecret,
} from './auth.js'
import { handleFinanceRoute } from '../saludFinanciera/server/routes.js'
import { handleFamilyRoute } from './family.js'
import { serveStatic } from './static.js'
import { handleEvidenceRoute } from './evidence.js'
import { handleGoogleCalendarRoute } from './google-calendar.js'

const port = Number(process.env.API_PORT || 3001)
const host = process.env.API_HOST || '127.0.0.1'
const maxBodyBytes = 16 * 1024

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(payload))
}

async function readJson(request, bodyLimit = maxBodyBytes) {
  const chunks = []
  let bodyBytes = 0

  for await (const chunk of request) {
    bodyBytes += chunk.length
    if (bodyBytes > bodyLimit) {
      const error = new Error('La solicitud es demasiado grande.')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }

  const body = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = body ? JSON.parse(body) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('El cuerpo debe ser un objeto JSON.')
    }
    return parsed
  } catch {
    const error = new Error('El cuerpo de la solicitud debe ser JSON válido.')
    error.statusCode = 400
    throw error
  }
}

async function getUserId(request, response) {
  const userId = await getSessionUserId(request)
  if (!userId) {
    sendJson(response, 401, { error: 'Inicia sesión para continuar.' })
    return null
  }
  return userId
}

export const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  const route = `${request.method} ${url.pathname}`

  try {
    if (route === 'GET /api/health/db') {
      const connection = await pool.getConnection()
      try {
        await connection.query('SELECT 1')
        console.log(`[DB] Verificación correcta: ${databaseConfig.database}`)
        sendJson(response, 200, { ok: true, database: 'connected' })
      } finally {
        connection.release()
      }
      return
    }

    if (route === 'POST /api/auth/register') {
      const body = await readJson(request)
      const user = await registerUser(body.name, body.password, body.photo, body.recoveryKey, body.theme)
      setSessionCookie(response, user.id, user.sessionVersion)
      sendJson(response, 201, { user })
      return
    }

    if (route === 'POST /api/auth/login') {
      const body = await readJson(request)
      const user = await authenticateUser(body.name, body.password)
      setSessionCookie(response, user.id, user.sessionVersion)
      sendJson(response, 200, { user })
      return
    }

    if (route === 'POST /api/auth/logout') {
      clearSessionCookie(response)
      sendJson(response, 200, { ok: true })
      return
    }

    if (route === 'POST /api/auth/recover') {
      const body = await readJson(request)
      await recoverPassword(body.name, body.recoveryKey, body.password, request.socket.remoteAddress)
      clearSessionCookie(response)
      sendJson(response, 200, { ok: true })
      return
    }

    const profileRoute = /^\/api\/users\/(\d+)\/profile$/.exec(url.pathname)
    if (route === 'PUT /api/auth/profile' || (request.method === 'PUT' && profileRoute)) {
      const userId = await getUserId(request, response)
      if (!userId) return
      if (profileRoute && Number(profileRoute[1]) !== userId) {
        sendJson(response, 403, { error: 'Solo puedes modificar tu propio perfil.' })
        return
      }
      const user = await updateProfile(userId, await readJson(request))
      sendJson(response, 200, { user })
      return
    }

    if (route === 'PUT /api/auth/theme') {
      const userId = await getUserId(request, response)
      if (!userId) return
      const { theme, appearance } = await readJson(request)
      sendJson(response, 200, { user: await updateTheme(userId, theme, appearance) })
      return
    }

    if (route === 'GET /api/auth/me') {
      const userId = await getUserId(request, response)
      if (!userId) return
      const user = await findSessionUser(userId)
      if (!user) {
        clearSessionCookie(response)
        sendJson(response, 401, { error: 'La sesión ya no es válida.' })
        return
      }
      sendJson(response, 200, { user })
      return
    }

    if (await handleGoogleCalendarRoute(request, response, url, { getUserId, sendJson })) return
    if (await handleEvidenceRoute(request, response, url, { getUserId, sendJson })) return
    if (await handleFamilyRoute(request, response, url, { getUserId, readJson, sendJson })) return
    if (await handleFinanceRoute(request, response, url, { getUserId, readJson, sendJson })) return

    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      if (await serveStatic(request, response, url.pathname)) return
    }
    sendJson(response, 404, { error: 'Ruta no encontrada.' })
  } catch (error) {
    const statusCode = error.statusCode || 500
    if (statusCode >= 500) {
      console.error(`[API] Error ${route}: ${error.code || error.message}`)
      if (error.code === 'ER_BAD_FIELD_ERROR' && error.sqlMessage) {
        console.error(`[DB] ${error.sqlMessage}`)
      }
    }
    sendJson(response, statusCode, {
      error: statusCode >= 500 ? 'Ocurrió un error interno.' : error.message,
    })
  }
})

async function start() {
  validateSessionSecret()
  const connection = await pool.getConnection()
  try {
    const [rows] = await connection.query('SELECT DATABASE() AS databaseName')
    if (rows[0].databaseName !== databaseConfig.database) {
      throw new Error(`La conexión no usa la base esperada (${databaseConfig.database}).`)
    }
    console.log(`[DB] Conectado a ${databaseConfig.host}:${databaseConfig.port}/${rows[0].databaseName}`)
  } finally {
    connection.release()
  }

  server.listen(port, host, () => {
    console.log(`[API] Escuchando en http://${host}:${port}`)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(async (error) => {
    console.error(`[DB] No se pudo iniciar: ${error.code || error.message}`)
    await pool.end()
    process.exitCode = 1
  })
}
