import { createServer } from 'node:http'
import { databaseConfig, pool } from './db.js'
import {
  authenticateUser,
  clearSessionCookie,
  findSessionUser,
  getSessionUserId,
  registerUser,
  setSessionCookie,
  validateSessionSecret,
} from './auth.js'
import {
  createAccount,
  deleteAccount,
  getDashboardData,
  updateAccount,
} from './dashboard.js'
import { deleteMovement, saveMovement } from './movements.js'
import {
  createPlan,
  createSubscription,
  deletePlan,
  deleteSubscription,
  updatePlan,
  updateSubscription,
} from './modules.js'
import { getCalendarData } from './calendar.js'

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

async function readJson(request) {
  const chunks = []
  let bodyBytes = 0

  for await (const chunk of request) {
    bodyBytes += chunk.length
    if (bodyBytes > maxBodyBytes) {
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

function getUserId(request, response) {
  const userId = getSessionUserId(request)
  if (!userId) {
    sendJson(response, 401, { error: 'Inicia sesión para continuar.' })
    return null
  }
  return userId
}

const server = createServer(async (request, response) => {
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
      const user = await registerUser(body.name, body.password)
      setSessionCookie(response, user.id)
      sendJson(response, 201, { user })
      return
    }

    if (route === 'POST /api/auth/login') {
      const body = await readJson(request)
      const user = await authenticateUser(body.name, body.password)
      setSessionCookie(response, user.id)
      sendJson(response, 200, { user })
      return
    }

    if (route === 'POST /api/auth/logout') {
      clearSessionCookie(response)
      sendJson(response, 200, { ok: true })
      return
    }

    if (route === 'GET /api/auth/me') {
      const userId = getUserId(request, response)
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

    if (route === 'GET /api/dashboard') {
      const userId = getUserId(request, response)
      if (!userId) return
      sendJson(response, 200, await getDashboardData(userId))
      return
    }

    if (route === 'GET /api/calendar') {
      const userId = getUserId(request, response)
      if (!userId) return
      const month = url.searchParams.get('month') || ''
      sendJson(response, 200, await getCalendarData(userId, month))
      return
    }

    if (route === 'POST /api/accounts') {
      const userId = getUserId(request, response)
      if (!userId) return
      const account = await createAccount(userId, await readJson(request))
      sendJson(response, 201, account)
      return
    }

    const accountRoute = /^\/api\/accounts\/(\d+)$/.exec(url.pathname)
    if (accountRoute && ['PUT', 'DELETE'].includes(request.method)) {
      const userId = getUserId(request, response)
      if (!userId) return
      const id = Number(accountRoute[1])
      if (!Number.isSafeInteger(id) || id <= 0) {
        const error = new Error('La cuenta no es válida.')
        error.statusCode = 400
        throw error
      }

      const result = request.method === 'PUT'
        ? await updateAccount(userId, id, await readJson(request))
        : await deleteAccount(userId, id)
      sendJson(response, 200, result)
      return
    }

    if (route === 'POST /api/subscriptions') {
      const userId = getUserId(request, response)
      if (!userId) return
      sendJson(response, 201, await createSubscription(userId, await readJson(request)))
      return
    }

    const subscriptionRoute = /^\/api\/subscriptions\/(\d+)$/.exec(url.pathname)
    if (subscriptionRoute && ['PUT', 'DELETE'].includes(request.method)) {
      const userId = getUserId(request, response)
      if (!userId) return
      const id = Number(subscriptionRoute[1])
      const result = request.method === 'PUT'
        ? await updateSubscription(userId, id, await readJson(request))
        : await deleteSubscription(userId, id)
      sendJson(response, 200, result)
      return
    }

    if (route === 'POST /api/plans') {
      const userId = getUserId(request, response)
      if (!userId) return
      sendJson(response, 201, await createPlan(userId, await readJson(request)))
      return
    }

    const planRoute = /^\/api\/plans\/(\d+)$/.exec(url.pathname)
    if (planRoute && ['PUT', 'DELETE'].includes(request.method)) {
      const userId = getUserId(request, response)
      if (!userId) return
      const id = Number(planRoute[1])
      const result = request.method === 'PUT'
        ? await updatePlan(userId, id, await readJson(request))
        : await deletePlan(userId, id)
      sendJson(response, 200, result)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/movements') {
      const userId = getUserId(request, response)
      if (!userId) return
      sendJson(response, 201, await saveMovement(userId, await readJson(request)))
      return
    }

    const movementRoute = /^\/api\/movements\/(\d+)$/.exec(url.pathname)
    if (movementRoute && ['PUT', 'DELETE'].includes(request.method)) {
      const userId = getUserId(request, response)
      if (!userId) return
      const movementId = Number(movementRoute[1])
      if (!Number.isSafeInteger(movementId) || movementId <= 0) {
        const error = new Error('El movimiento no es válido.')
        error.statusCode = 400
        throw error
      }

      if (request.method === 'PUT') {
        sendJson(response, 200, await saveMovement(userId, await readJson(request), movementId))
      } else {
        sendJson(response, 200, await deleteMovement(userId, movementId))
      }
      return
    }

    sendJson(response, 404, { error: 'Ruta no encontrada.' })
  } catch (error) {
    const statusCode = error.statusCode || 500
    if (statusCode >= 500) {
      console.error(`[API] Error ${route}: ${error.code || error.message}`)
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

start().catch(async (error) => {
  console.error(`[DB] No se pudo iniciar: ${error.code || error.message}`)
  await pool.end()
  process.exitCode = 1
})
