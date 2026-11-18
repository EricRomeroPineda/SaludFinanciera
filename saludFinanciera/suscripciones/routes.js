import { createSubscription, deleteSubscription, getSubscriptions, updateSubscription } from './service.js'

export async function handleSubscriptionRoute(request, response, url, { getUserId, readJson, sendJson }) {
  const route = `${request.method} ${url.pathname}`
  if (route === 'GET /api/subscriptions') {
    const userId = await getUserId(request, response)
    if (!userId) return true
    sendJson(response, 200, { subscriptions: await getSubscriptions(userId) })
    return true
  }

  if (route === 'POST /api/subscriptions') {
    const userId = await getUserId(request, response)
    if (!userId) return true
    sendJson(response, 201, await createSubscription(userId, await readJson(request)))
    return true
  }

  const subscriptionRoute = /^\/api\/subscriptions\/(\d+)$/.exec(url.pathname)
  if (subscriptionRoute && ['PUT', 'DELETE'].includes(request.method)) {
    const userId = await getUserId(request, response)
    if (!userId) return true
    const id = Number(subscriptionRoute[1])
    const result = request.method === 'PUT'
      ? await updateSubscription(userId, id, await readJson(request))
      : await deleteSubscription(userId, id)
    sendJson(response, 200, result)
    return true
  }

  return false
}
