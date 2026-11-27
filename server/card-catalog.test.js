import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, writeFile, mkdir, symlink, rm, readFile, chmod } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHmac } from 'node:crypto'
import sharp from 'sharp'
import { pool } from './db.js'
import { getCatalogNames, getCatalogRules, saveCatalogRule, requireCatalogAdmin, handleCardCatalogRoute } from './card-catalog.js'
import {
  catalogDirectory, catalogImageBuffer, listCatalogFiles, readCatalogSource, readCatalogImage, writeCatalogImage,
} from './card-catalog-files.js'

after(() => pool.end())
const uuid = '11111111-1111-4111-8111-111111111111'
const reference = `${uuid}.webp`
const draft = { keyword: 'BBVA', scope: 'banco', kind: 'general', aliases: ['Bbbv'], file: reference }
const row = { id: 3, keyword: 'BBVA', scope: 'banco', kind: 'general', file: reference, version: uuid, alias: 'BBVA' }

async function storage(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sf-card-catalog-'))
  const directory = path.join(temporary, 'seguro de vida')
  await mkdir(directory)
  const previous = process.env.CARD_IMAGE_DIR
  process.env.CARD_IMAGE_DIR = directory
  t.after(async () => {
    if (previous === undefined) delete process.env.CARD_IMAGE_DIR
    else process.env.CARD_IMAGE_DIR = previous
    await rm(temporary, { recursive: true, force: true })
  })
  const image = await sharp({ create: { width: 900, height: 300, channels: 3, background: '#ff00aa' } }).png().toBuffer()
  await writeFile(path.join(directory, 'imagen original.png'), image)
  await writeFile(path.join(directory, reference), await catalogImageBuffer(image))
  return { temporary, directory, image }
}

function routeOptions(body = {}) {
  return { getUserId: async () => 7, readJson: async () => body,
    sendJson: (response, status, payload) => { response.status = status; response.payload = payload } }
}
const url = (suffix = '') => new URL(`http://localhost/api/admin/card-catalog${suffix}`)

test('administrator role is read live from MySQL, including revocation', async (t) => {
  let role = 'admin'
  t.mock.method(pool, 'execute', async (sql, params) => {
    assert.equal(sql, 'SELECT rol FROM usuario WHERE id = ?')
    assert.deepEqual(params, [7])
    return [[{ rol: role }]]
  })
  await requireCatalogAdmin(7)
  role = 'usuario'
  await assert.rejects(requireCatalogAdmin(7), { statusCode: 403 })
  role = undefined
  await assert.rejects(requireCatalogAdmin(7), { statusCode: 403 })
})

test('all administration routes reject normal users before reading bodies or files', async (t) => {
  t.mock.method(pool, 'execute', async () => [[{ rol: 'usuario' }]])
  const options = { ...routeOptions(), readJson: () => assert.fail('Must authorize before reading JSON') }
  for (const [method, suffix] of [
    ['GET', ''], ['POST', ''], ['PUT', '/1'], ['DELETE', '/1'], ['POST', '/preview'],
    ['GET', '/files'], ['GET', '/files/preview?name=test.png'], ['POST', '/upload'], ['POST', '/import'],
  ]) {
    await assert.rejects(handleCardCatalogRoute({ method }, {}, url(suffix), options), { statusCode: 403 })
  }
  assert.equal(await handleCardCatalogRoute({}, {}, url(), {
    ...options, getUserId: async () => null,
  }), true)
})

test('registry returns only name, type and normalized scope, never financial or owner details', async (t) => {
  t.mock.method(pool, 'execute', async (sql) => {
    assert.match(sql, /SELECT DISTINCT nombre AS name, tipo AS type FROM cuenta/)
    assert.match(sql, /FROM suscripciones/)
    assert.match(sql, /FROM plan_futuro/)
    assert.doesNotMatch(sql, /disponible|saldo|titular|usuario|persona|prestamo|deposito|total/i)
    return [[{ name: 'BBVA Nómina', type: 'Nómina', available: 2000, accountNumber: 'private', ownerName: 'private' }]]
  })
  assert.deepEqual(await getCatalogNames(), [{ name: 'BBVA Nómina', type: 'Nómina', scope: 'nomina' }])
})

test('rules include aliases but exclude duplicate canonical alias', async (t) => {
  t.mock.method(pool, 'execute', async () => [[row, { ...row, alias: 'Bbbv' }]])
  const rules = await getCatalogRules()
  assert.equal(rules.length, 1)
  assert.deepEqual(rules[0].aliases, ['Bbbv'])
  assert.equal(rules[0].imageUrl, `/api/card-images/3/${uuid}.webp`)
})

test('normal sessions resolve bank/product imagery and can read referenced images without administration', async (t) => {
  await storage(t)
  t.mock.method(pool, 'execute', async (sql, params) => {
    assert.doesNotMatch(sql, /SELECT rol|UPDATE|INSERT|DELETE/)
    if (sql.startsWith('SELECT archivo')) {
      return params[0] === 3 && params[1] === uuid ? [[{ archivo: reference }]] : [[]]
    }
    return [[row, { ...row, id: 4, keyword: 'BBVA Vive', scope: 'credito', kind: 'producto', alias: 'BBVA Vive' }]]
  })
  for (const [name, type, id] of [['BBVA Nómina', 'Nómina', 3], ['BBVA Vive', 'Crédito', 4], ['BBVA Oro', 'Crédito', 3], ['Sin imagen', 'Débito', null]]) {
    const response = {}
    await handleCardCatalogRoute({ method: 'GET' }, response,
      new URL(`http://localhost/api/card-images/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`), routeOptions())
    assert.deepEqual(response.payload, { imageUrl: id ? `/api/card-images/${id}/${uuid}.webp` : null })
  }
  let headers
  let body
  const response = { writeHead: (status, values) => { assert.equal(status, 200); headers = values }, end: (value) => { body = value } }
  await handleCardCatalogRoute({ method: 'GET' }, response, new URL(`http://localhost/api/card-images/3/${uuid}.webp`), routeOptions())
  assert.equal(headers['Content-Type'], 'image/webp')
  assert.equal(headers['Cache-Control'], 'private, no-store')
  assert.equal((await sharp(body).metadata()).format, 'webp')
  await handleCardCatalogRoute({ method: 'HEAD' }, response, new URL(`http://localhost/api/card-images/3/${uuid}.webp`), routeOptions())
  assert.equal(body, undefined)
  await assert.rejects(handleCardCatalogRoute({ method: 'GET' }, response,
    new URL(`http://localhost/api/card-images/999/${uuid}.webp`), routeOptions()), { statusCode: 404 })
})

test('preview distinguishes effective product matches and proposes existing rules for typos', async (t) => {
  t.mock.method(pool, 'execute', async (sql) => {
    if (sql.startsWith('SELECT rol')) return [[{ rol: 'admin' }]]
    if (sql.includes('FROM catalogo_tarjeta_imagen')) return [[row]]
    return [[{ name: 'BBVA Nómina', type: 'Nómina' }, { name: 'BBVA Vivee', type: 'Crédito' }]]
  })
  const response = {}
  await handleCardCatalogRoute({ method: 'POST' }, response, url('/preview'), routeOptions({ ...draft, keyword: 'Bbbv' }))
  assert.equal(response.payload.similar[0].keyword, 'BBVA')
  await handleCardCatalogRoute({ method: 'POST' }, response, url('/preview'),
    routeOptions({ ...draft, keyword: 'BBVA Vive', scope: 'credito', kind: 'producto' }))
  assert.ok(response.payload.suggestions.some((suggestion) => suggestion.alias === 'bbva vivee'))
})

test('rule writes are transactional and store canonical keyword and normalized unique aliases', async (t) => {
  await storage(t)
  const statements = []
  let committed = false
  let released = false
  t.mock.method(pool, 'execute', async () => [[{ rol: 'admin' }]])
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => {},
    execute: async (sql, params) => { statements.push([sql, params]); return [{ insertId: 8 }] },
    commit: async () => { committed = true }, rollback: async () => assert.fail('Unexpected rollback'),
    release: () => { released = true },
  }))
  assert.deepEqual(await saveCatalogRule(7, { ...draft, keyword: ' BBVA ', aliases: ['bbva', ' Bbbv ', 'Bbbv'] }), { id: 8 })
  const aliases = statements.filter(([sql]) => sql.startsWith('INSERT INTO catalogo_tarjeta_alias'))
  assert.equal(aliases.length, 2)
  assert.deepEqual(aliases.map(([, params]) => params[3]), ['bbva', 'bbbv'])
  assert.ok(committed && released)
  assert.ok(statements.every(([sql]) => !/\b(cuenta|movimiento|suscripciones|plan_futuro)\b/.test(sql)))
})

test('duplicate aliases roll back the entire rule and return an actionable conflict', async (t) => {
  await storage(t)
  let rolledBack = false
  let released = false
  t.mock.method(pool, 'execute', async () => [[{ rol: 'admin' }]])
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => {},
    execute: async (sql) => {
      if (sql.includes('INSERT INTO catalogo_tarjeta_alias')) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
      return [{ insertId: 8 }]
    },
    commit: async () => assert.fail('Must not commit'),
    rollback: async () => { rolledBack = true }, release: () => { released = true },
  }))
  await assert.rejects(saveCatalogRule(7, draft), { statusCode: 409, message: /alias ya pertenece/ })
  assert.ok(rolledBack && released)
})

test('editing replaces aliases in one transaction; deleting touches only the catalog rule', async (t) => {
  await storage(t)
  const statements = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    statements.push([sql, params])
    return sql.startsWith('SELECT rol') ? [[{ rol: 'admin' }]] : [{ affectedRows: 1 }]
  })
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => {},
    execute: async (sql, params) => {
      statements.push([sql, params])
      return sql.startsWith('SELECT id') ? [[{ id: 3 }]] : [{ affectedRows: 1 }]
    },
    commit: async () => {}, rollback: async () => assert.fail('Unexpected rollback'), release: () => {},
  }))
  const response = {}
  await handleCardCatalogRoute({ method: 'PUT' }, response, url('/3'), routeOptions({ ...draft, aliases: ['Bbbv', 'BB VA'] }))
  assert.equal(response.payload.id, 3)
  const deletion = statements.findIndex(([sql]) => sql === 'DELETE FROM catalogo_tarjeta_alias WHERE id_regla = ?')
  const insertion = statements.findIndex(([sql]) => sql.startsWith('INSERT INTO catalogo_tarjeta_alias'))
  assert.ok(deletion >= 0 && deletion < insertion)
  assert.ok(statements.some(([sql]) => sql.startsWith('UPDATE catalogo_tarjeta_imagen')))
  await handleCardCatalogRoute({ method: 'DELETE' }, response, url('/3'), routeOptions())
  assert.deepEqual(response.payload, { ok: true })
  assert.ok(statements.some(([sql, params]) => sql === 'DELETE FROM catalogo_tarjeta_imagen WHERE id = ?' && params[0] === 3))
  assert.ok(statements.every(([sql]) => !/\b(cuenta|movimiento|suscripciones|plan_futuro)\b/.test(sql)))
  assert.ok((await listCatalogFiles()).includes(reference))
})

test('admin upload validates raw image MIME, stores a safe reference and supports existing-file import', async (t) => {
  const { image } = await storage(t)
  t.mock.method(pool, 'execute', async () => [[{ rol: 'admin' }]])
  const { Readable } = await import('node:stream')
  const request = Readable.from([image])
  request.method = 'POST'
  request.headers = { 'content-type': 'image/png', 'content-length': String(image.length) }
  const response = {}
  await handleCardCatalogRoute(request, response, url('/upload'), routeOptions())
  assert.equal(response.status, 201)
  assert.match(response.payload.file, /^[a-f0-9-]{36}\.webp$/)
  assert.equal((await sharp(await readCatalogImage(response.payload.file)).metadata()).format, 'webp')
  await handleCardCatalogRoute({ method: 'POST' }, response, url('/import'), routeOptions({ name: 'imagen original.png' }))
  assert.equal(response.status, 201)
  assert.match(response.payload.file, /^[a-f0-9-]{36}\.webp$/)
  await assert.rejects(handleCardCatalogRoute({ method: 'POST', headers: { 'content-type': 'image/svg+xml' } },
    response, url('/upload'), routeOptions()), { statusCode: 415 })
})

test('invalid scopes, product types, aliases and relative references are rejected before a transaction', async (t) => {
  t.mock.method(pool, 'execute', async () => [[{ rol: 'admin' }]])
  t.mock.method(pool, 'getConnection', () => assert.fail('Invalid input must not reach a transaction'))
  for (const input of [
    { keyword: ' -- ' }, { keyword: 'x'.repeat(151) }, { scope: 'invalid' }, { kind: 'producto' },
    { aliases: 'not-an-array' }, { aliases: [null] }, { aliases: ['x'.repeat(151)] }, { file: '../private.webp' },
  ]) await assert.rejects(saveCatalogRule(7, { ...draft, ...input }), { statusCode: 400 })
})

test('files in a directory with spaces are imported and optimized without distortion or source changes', async (t) => {
  const { directory, image } = await storage(t)
  const imported = await readCatalogSource('imagen original.png')
  const metadata = await sharp(imported).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.width, 512)
  assert.equal(metadata.height, 171)
  const file = await writeCatalogImage(imported)
  assert.match(file, /^[a-f0-9-]{36}\.webp$/)
  assert.equal((await readCatalogImage(file)).length, imported.length)
  assert.deepEqual(await readFile(path.join(directory, 'imagen original.png')), image)
  assert.ok((await listCatalogFiles()).includes('imagen original.png'))
})

test('catalog rejects traversal, symlinks, invalid content and oversized files', async (t) => {
  const { directory, temporary, image } = await storage(t)
  for (const name of ['../private.png', '/tmp/private.png', 'nested/file.png', '.hidden.png', 'file.svg', null]) {
    await assert.rejects(readCatalogSource(name), { statusCode: 400 })
  }
  await writeFile(path.join(temporary, 'outside.png'), image)
  await symlink(path.join(temporary, 'outside.png'), path.join(directory, 'linked.png'))
  await assert.rejects(readCatalogSource('linked.png'), { statusCode: 400 })
  assert.ok(!(await listCatalogFiles()).includes('linked.png'))
  await writeFile(path.join(directory, 'fake.png'), '<svg><script>alert(1)</script></svg>')
  await assert.rejects(readCatalogSource('fake.png'), { statusCode: 400 })
  await writeFile(path.join(directory, 'large.png'), Buffer.alloc(5 * 1024 * 1024 + 1))
  await assert.rejects(readCatalogSource('large.png'), { statusCode: 400 })
  await assert.rejects(catalogImageBuffer(Buffer.alloc(5 * 1024 * 1024 + 1)), { statusCode: 413 })
  await assert.rejects(readCatalogImage('../private.png'), { statusCode: 404 })
})

test('missing directory returns an explicit mount/permissions error and is never created automatically', async (t) => {
  const { temporary } = await storage(t)
  process.env.CARD_IMAGE_DIR = path.join(temporary, 'not mounted')
  await assert.rejects(catalogDirectory(true), { statusCode: 503, expose: true, message: /disco esté montado.*apps/ })
  await assert.rejects(listCatalogFiles(), { statusCode: 503 })
})

test('a read-only catalog directory reports a clear administrator permissions error', async (t) => {
  if (process.getuid?.() === 0) return t.skip('Root bypasses filesystem permissions')
  const { directory } = await storage(t)
  await chmod(directory, 0o500)
  try {
    await assert.rejects(catalogDirectory(true), { statusCode: 503, expose: true, message: /permisos/ })
  } finally { await chmod(directory, 0o700) }
})

test('HTTP session integration enforces 401/403, serves user images and exposes safe disk errors to admins', async (t) => {
  const { temporary } = await storage(t)
  process.env.SESSION_SECRET = 'test-secret-card-catalog-http-session-only'
  const { server } = await import('./index.js')
  const { createSession } = await import('./auth.js')
  let role = 'usuario'
  const passwordHash = 'test-password-hash'
  t.mock.method(pool, 'execute', async (sql) => {
    if (sql.startsWith('SELECT password_hash')) return [[{ password_hash: passwordHash }]]
    if (sql.startsWith('SELECT rol')) return [[{ rol: role }]]
    if (sql.startsWith('SELECT archivo')) return [[{ archivo: reference }]]
    if (sql.includes('FROM catalogo_tarjeta_imagen')) return [[row]]
    if (sql.includes('FROM cuenta')) return [[{ name: 'BBVA Nómina', type: 'Nómina' }]]
    assert.fail(`Unexpected SQL: ${sql}`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const version = createHmac('sha256', process.env.SESSION_SECRET).update(`session-password:${passwordHash}`).digest('base64url')
  const headers = { cookie: `salud_financiera_session=${createSession(7, version)}` }
  try {
    assert.equal((await fetch(`${base}/api/admin/card-catalog`)).status, 401)
    assert.equal((await fetch(`${base}/api/card-images/resolve?name=BBVA&type=Débito`)).status, 401)
    assert.equal((await fetch(`${base}/api/admin/card-catalog`, { headers })).status, 403)
    const resolution = await fetch(`${base}/api/card-images/resolve?name=BBVA&type=Débito`, { headers })
    assert.equal(resolution.status, 200)
    const { imageUrl } = await resolution.json()
    const image = await fetch(`${base}${imageUrl}`, { headers })
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/webp')
    role = 'admin'
    const catalog = await fetch(`${base}/api/admin/card-catalog`, { headers })
    assert.equal(catalog.status, 200)
    assert.deepEqual((await catalog.json()).names, [{ name: 'BBVA Nómina', type: 'Nómina', scope: 'nomina', ruleId: 3 }])
    process.env.CARD_IMAGE_DIR = path.join(temporary, 'missing mount')
    const unavailable = await fetch(`${base}/api/admin/card-catalog/files`, { headers })
    assert.equal(unavailable.status, 503)
    assert.match((await unavailable.json()).error, /disco esté montado.*apps/)
    role = 'usuario'
    assert.equal((await fetch(`${base}/api/admin/card-catalog`, { headers })).status, 403)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('migration adds catalog-only tables and constraints without changing existing financial records', async () => {
  const sql = await readFile(new URL('./migrations/015-card-image-catalog.sql', import.meta.url), 'utf8')
  assert.match(sql, /rol ENUM\('usuario', 'admin'\) NOT NULL DEFAULT 'usuario'/)
  assert.match(sql, /GENERATED ALWAYS AS \(LOWER\(TRIM\(palabra\)\)\) STORED/)
  assert.match(sql, /UNIQUE KEY uq_catalogo_regla_ambito \(ambito, normalizada\)/)
  assert.match(sql, /UNIQUE KEY uq_catalogo_alias_ambito \(ambito, normalizada\)/)
  assert.match(sql, /ON DELETE CASCADE/)
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE FROM|TRUNCATE|DROP TABLE)\b/i)
})
