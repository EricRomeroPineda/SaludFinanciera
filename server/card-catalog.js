import { randomUUID } from 'node:crypto'
import { pool } from './db.js'
import { catalogScopes, cardScope, normalizeCardName, resolveCardRule, similarCardNames, aliasSuggestions } from '../shared/card-catalog.js'
import { readImage } from './evidence.js'
import {
  catalogFilePattern, catalogImageBuffer, listCatalogFiles, readCatalogImage,
  readCatalogSource, writeCatalogImage,
} from './card-catalog-files.js'

const invalid = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
export const catalogImageUrl = (rule) => `/api/card-images/${rule.id}/${rule.version}.webp`

export async function requireCatalogAdmin(userId) {
  const [users] = await pool.execute('SELECT rol FROM usuario WHERE id = ?', [userId])
  if (users[0]?.rol !== 'admin') throw invalid('Solo un administrador puede configurar el catálogo de imágenes.', 403)
}

export async function getCatalogRules(connection = pool) {
  const [rows] = await connection.execute(
    `SELECT r.id, r.palabra AS keyword, r.ambito AS scope, r.clase AS kind, r.archivo AS file,
            r.version, a.palabra AS alias
     FROM catalogo_tarjeta_imagen r
     LEFT JOIN catalogo_tarjeta_alias a ON a.id_regla = r.id
     ORDER BY r.id, a.id`,
  )
  const rules = new Map()
  for (const row of rows) {
    if (!rules.has(row.id)) rules.set(row.id, { id: row.id, keyword: row.keyword, scope: row.scope,
      kind: row.kind, file: row.file, version: row.version, imageUrl: catalogImageUrl(row), aliases: [] })
    if (row.alias && normalizeCardName(row.alias) !== normalizeCardName(row.keyword)) rules.get(row.id).aliases.push(row.alias)
  }
  return [...rules.values()]
}

export async function getCatalogNames() {
  const [rows] = await pool.execute(
    `SELECT DISTINCT nombre AS name, tipo AS type FROM cuenta
     UNION SELECT DISTINCT nombre AS name, tipo AS type FROM suscripciones
     UNION SELECT DISTINCT nombre AS name, 'plan' AS type FROM plan_futuro
     ORDER BY type, name`,
  )
  return rows.map(({ name, type }) => ({ name, type, scope: cardScope(type) })).filter((entry) => entry.scope)
}

function ruleInput(input) {
  const keyword = String(input.keyword || '').trim()
  const scope = String(input.scope || '')
  const kind = input.kind || 'general'
  if (!keyword || keyword.length > 150 || !normalizeCardName(keyword) || normalizeCardName(keyword).length > 150) throw invalid('Escribe una palabra o frase de hasta 150 caracteres.')
  if (!catalogScopes.some(([value]) => value === scope)) throw invalid('Selecciona un tipo válido.')
  if (!['general', 'producto'].includes(kind) || (kind === 'producto' && scope !== 'credito')) throw invalid('Las reglas de producto son solo para tarjetas de crédito.')
  if (!Array.isArray(input.aliases) || input.aliases.length > 50 || input.aliases.some((alias) =>
    typeof alias !== 'string' || !normalizeCardName(alias) || alias.length > 150 || normalizeCardName(alias).length > 150)) {
    throw invalid('Los alias deben ser frases de hasta 150 caracteres; máximo 50 por regla.')
  }
  const phrases = [...new Map([keyword, ...input.aliases].map((phrase) => [normalizeCardName(phrase), phrase.trim()])).values()]
  if (typeof input.file !== 'string' || !catalogFilePattern.test(input.file)) throw invalid('Carga o selecciona una imagen del catálogo.')
  return { keyword, scope, kind, phrases, file: input.file }
}

export async function saveCatalogRule(userId, input, id = null) {
  await requireCatalogAdmin(userId)
  const rule = ruleInput(input)
  await catalogImageBuffer(await readCatalogImage(rule.file))
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    if (id) {
      const [existing] = await connection.execute('SELECT id FROM catalogo_tarjeta_imagen WHERE id = ? FOR UPDATE', [id])
      if (!existing.length) throw invalid('No se encontró la regla.', 404)
      await connection.execute(
        'UPDATE catalogo_tarjeta_imagen SET palabra = ?, ambito = ?, clase = ?, archivo = ?, version = ? WHERE id = ?',
        [rule.keyword, rule.scope, rule.kind, rule.file, randomUUID(), id],
      )
      await connection.execute('DELETE FROM catalogo_tarjeta_alias WHERE id_regla = ?', [id])
    } else {
      const [result] = await connection.execute(
        'INSERT INTO catalogo_tarjeta_imagen (palabra, ambito, clase, archivo, version) VALUES (?, ?, ?, ?, ?)',
        [rule.keyword, rule.scope, rule.kind, rule.file, randomUUID()],
      )
      id = result.insertId
    }
    for (const phrase of rule.phrases) {
      await connection.execute(
        'INSERT INTO catalogo_tarjeta_alias (id_regla, ambito, palabra, normalizada) VALUES (?, ?, ?, ?)',
        [id, rule.scope, phrase, normalizeCardName(phrase)],
      )
    }
    await connection.commit()
    return { id }
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') throw invalid('La palabra o uno de sus alias ya pertenece a otra regla de este tipo. Edita esa regla para asociarlo como alias.', 409)
    throw error
  } finally {
    connection.release()
  }
}

async function imageResponse(response, buffer, head = false) {
  response.writeHead(200, {
    'Content-Type': 'image/webp', 'Content-Length': buffer.length,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  })
  response.end(head ? undefined : buffer)
}

export async function handleCardCatalogRoute(request, response, url, { getUserId, readJson, sendJson }) {
  const admin = url.pathname === '/api/admin/card-catalog' || url.pathname.startsWith('/api/admin/card-catalog/')
  const publicImage = /^\/api\/card-images\/(\d+)\/([a-f0-9-]{36})\.webp$/.exec(url.pathname)
  const resolve = url.pathname === '/api/card-images/resolve'
  if (!admin && !publicImage && !resolve) return false
  const userId = await getUserId(request, response)
  if (!userId) return true
  if (admin) await requireCatalogAdmin(userId)
  if (publicImage && ['GET', 'HEAD'].includes(request.method)) {
    const [rows] = await pool.execute(
      'SELECT archivo FROM catalogo_tarjeta_imagen WHERE id = ? AND version = ?', [Number(publicImage[1]), publicImage[2]],
    )
    if (!rows.length) throw invalid('No se encontró la imagen del catálogo.', 404)
    await imageResponse(response, await readCatalogImage(rows[0].archivo), request.method === 'HEAD')
  } else if (resolve && request.method === 'GET') {
    const name = url.searchParams.get('name') || ''
    const type = url.searchParams.get('type') || ''
    if (name.length > 150 || type.length > 50 || !cardScope(type)) throw invalid('Nombre o tipo no válido.')
    const rule = resolveCardRule(await getCatalogRules(), name, type)
    sendJson(response, 200, { imageUrl: rule ? catalogImageUrl(rule) : null })
  } else if (admin && url.pathname === '/api/admin/card-catalog' && request.method === 'GET') {
    const [rules, names] = await Promise.all([getCatalogRules(), getCatalogNames()])
    sendJson(response, 200, { rules, names: names.map((entry) => ({
      ...entry, ruleId: resolveCardRule(rules, entry.name, entry.type)?.id || null,
    })), suggestions: aliasSuggestions(rules, names) })
  } else if (admin && url.pathname === '/api/admin/card-catalog/preview' && request.method === 'POST') {
    const input = await readJson(request)
    const keyword = String(input.keyword || '').slice(0, 150)
    const scope = String(input.scope || '')
    const aliases = Array.isArray(input.aliases) ? input.aliases.filter((value) => typeof value === 'string').slice(0, 50).map((value) => value.slice(0, 150)) : []
    const [rules, names] = await Promise.all([getCatalogRules(), getCatalogNames()])
    const draftId = Number(input.id) || -1
    const draft = { id: draftId, keyword, scope, kind: input.kind, aliases }
    const others = rules.filter((rule) => rule.id !== draftId)
    const similar = others.filter((rule) => rule.scope === scope && [rule.keyword, ...rule.aliases]
      .some((phrase) => normalizeCardName(phrase) === normalizeCardName(keyword) || similarCardNames(phrase, keyword)))
    sendJson(response, 200, { similar, matches: names.filter((entry) => resolveCardRule([draft], entry.name, entry.type)).map((entry) => ({
      ...entry, selected: resolveCardRule([...others, draft], entry.name, entry.type)?.id === draftId,
    })), suggestions: aliasSuggestions([draft], names) })
  } else if (admin && url.pathname === '/api/admin/card-catalog/files' && request.method === 'GET') {
    sendJson(response, 200, { files: await listCatalogFiles() })
  } else if (admin && url.pathname === '/api/admin/card-catalog/files/preview' && request.method === 'GET') {
    await imageResponse(response, await readCatalogSource(url.searchParams.get('name')))
  } else if (admin && url.pathname === '/api/admin/card-catalog/upload' && request.method === 'POST') {
    const buffer = await catalogImageBuffer(await readImage(request))
    sendJson(response, 201, { file: await writeCatalogImage(buffer) })
  } else if (admin && url.pathname === '/api/admin/card-catalog/import' && request.method === 'POST') {
    const { name } = await readJson(request)
    sendJson(response, 201, { file: await writeCatalogImage(await readCatalogSource(name)) })
  } else if (admin && url.pathname === '/api/admin/card-catalog' && request.method === 'POST') {
    sendJson(response, 201, await saveCatalogRule(userId, await readJson(request)))
  } else {
    const match = /^\/api\/admin\/card-catalog\/([1-9]\d*)$/.exec(url.pathname)
    if (match && request.method === 'PUT') sendJson(response, 200, await saveCatalogRule(userId, await readJson(request), Number(match[1])))
    else if (match && request.method === 'DELETE') {
      const [result] = await pool.execute('DELETE FROM catalogo_tarjeta_imagen WHERE id = ?', [Number(match[1])])
      if (!result.affectedRows) throw invalid('No se encontró la regla.', 404)
      sendJson(response, 200, { ok: true })
    } else throw invalid('Ruta de catálogo no encontrada.', 404)
  }
  return true
}
