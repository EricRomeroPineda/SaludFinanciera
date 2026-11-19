import { handleSubscriptionRoute } from '../suscripciones/routes.js'
import {
  createAccount,
  deleteAccount,
  getDashboardData,
  updateAccount,
} from './dashboard.js'
import { deleteMovement, getRelatedMovements, saveMovement } from './movements.js'
import {
  createPlan,
  deletePlan,
  updatePlan,
} from './modules.js'
import { getCalendarData } from './calendar.js'
import { createCategory } from './categories.js'

export async function handleFinanceRoute(request, response, url, { getUserId, readJson, sendJson }) {
  const route = `${request.method} ${url.pathname}`
  if (await handleSubscriptionRoute(request, response, url, { getUserId, readJson, sendJson })) return true
  if (route === 'GET /api/dashboard') {
    const userId = await getUserId(request, response)
    if (!userId) return true
    sendJson(response, 200, await getDashboardData(userId))
    return true
  }

  if (route === 'GET /api/calendar') {
    const userId = await getUserId(request, response)
    if (!userId) return true
    const month = url.searchParams.get('month') || ''
    sendJson(response, 200, await getCalendarData(userId, month))
    return true
  }

  if (route === 'POST /api/categories') {
    const userId = await getUserId(request, response)
    if (!userId) return true
    sendJson(response, 201, await createCategory(await readJson(request)))
    return true
  }

  if (route === 'POST /api/accounts') {
    const userId = await getUserId(request, response)
    if (!userId) return true
    const account = await createAccount(userId, await readJson(request))
    sendJson(response, 201, account)
    return true
  }

  const accountRoute = /^\/api\/accounts\/(\d+)$/.exec(url.pathname)
  if (accountRoute && ['PUT', 'DELETE'].includes(request.method)) {
    const userId = await getUserId(request, response)
    if (!userId) return true
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
    return true
  }

  if (route === 'POST /api/plans') {
    const userId = await getUserId(request, response)
    if (!userId) return true
    sendJson(response, 201, await createPlan(userId, await readJson(request)))
    return true
  }

  const planRoute = /^\/api\/plans\/(\d+)$/.exec(url.pathname)
  if (planRoute && ['PUT', 'DELETE'].includes(request.method)) {
    const userId = await getUserId(request, response)
    if (!userId) return true
    const id = Number(planRoute[1])
    const result = request.method === 'PUT'
      ? await updatePlan(userId, id, await readJson(request))
      : await deletePlan(userId, id)
    sendJson(response, 200, result)
    return true
  }

  if (route === 'GET /api/movements') {
    const userId = await getUserId(request, response)
    if (!userId) return true
    sendJson(response, 200, await getRelatedMovements(
      userId, url.searchParams.get('relation'), url.searchParams.get('id'),
    ))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/movements') {
    const userId = await getUserId(request, response)
    if (!userId) return true
    sendJson(response, 201, await saveMovement(userId, await readJson(request)))
    return true
  }

  const movementRoute = /^\/api\/movements\/(\d+)$/.exec(url.pathname)
  if (movementRoute && ['PUT', 'DELETE'].includes(request.method)) {
    const userId = await getUserId(request, response)
    if (!userId) return true
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
    return true
  }

  return false
}
