import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { pool } from './db.js'
import { deleteEvidence, getEvidence, handleEvidenceRoute, listEvidence, uploadEvidence } from './evidence.js'
import { maxEvidenceBytes, normalizeEvidence, promoteMovementImages, readEvidence, removeEvidenceFiles, writeEvidence } from './evidence-files.js'
import { deleteMovement } from '../saludFinanciera/server/movements.js'

async function image() {
  return sharp({ create: { width: 10, height: 10, channels: 3, background: '#112233' } }).png().toBuffer()
}

function database(t, { owner = 7, viewer = 7, count = 0, failInsert = false, verified = false } = {}) {
  const rows = []
  const calls = []
  let committed = false
  let rolledBack = false
  const execute = async (sql, params) => {
    calls.push({ sql, params })
    if (sql.startsWith('SELECT correo, correo_verificado')) return [[{ correo: 'ana@example.com', correo_verificado: Number(verified) }]]
    if (sql.includes('SELECT m.id_usuario AS ownerId')) {
      if (sql.includes('FOR UPDATE')) return [viewer === owner ? [{ ownerId: owner }] : []]
      return [[{ ownerId: owner }]]
    }
    if (sql.startsWith('SELECT id, nombre AS name')) return [rows.map((row) => ({ id: row.id, name: row.name }))]
    if (sql.startsWith('SELECT id FROM movimiento_evidencia')) return [Array.from({ length: count }, (_, id) => ({ id }))]
    if (sql.startsWith('INSERT INTO movimiento_evidencia')) {
      rows.push({ id: 1, movementId: params[0], archivo: params[1], name: params[2] })
      if (failInsert) throw new Error('insert failed')
      return [{ insertId: 1 }]
    }
    if (sql.startsWith('SELECT archivo')) return [rows.filter((row) => row.id === params[0] && row.movementId === params[1])]
    if (sql.startsWith('DELETE FROM movimiento_evidencia')) {
      rows.splice(0, rows.length)
      return [{ affectedRows: 1 }]
    }
    assert.fail(sql)
  }
  t.mock.method(pool, 'execute', execute)
  t.mock.method(pool, 'getConnection', async () => ({
    execute, beginTransaction: async () => {}, release() {},
    commit: async () => { committed = true },
    rollback: async () => { rolledBack = true },
  }))
  return { rows, calls, committed: () => committed, rolledBack: () => rolledBack }
}

test('images are fully decoded and re-encoded as WebP without EXIF; disguised and oversized uploads fail', async () => {
  const buffer = await sharp(await image()).withExif({ IFD0: { Artist: 'Private metadata' } }).jpeg().toBuffer()
  const result = await normalizeEvidence(buffer)
  const metadata = await sharp(result).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.width, 10)
  assert.equal(metadata.exif, undefined)
  for (const invalid of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), Buffer.from('not an image')]) {
    await assert.rejects(normalizeEvidence(invalid), { statusCode: 400 })
  }
  await assert.rejects(normalizeEvidence(Buffer.alloc(maxEvidenceBytes + 1)), { statusCode: 413 })
  const tooLarge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#000' } }).png().toBuffer()
  const reduced = await sharp(await normalizeEvidence(tooLarge)).metadata()
  assert.ok(reduced.width * reduced.height <= 20000000)
  assert.equal(reduced.width, reduced.height)
  const beyondLimit = await sharp({ create: { width: 10001, height: 10000, channels: 3, background: '#000' } }).png().toBuffer()
  await assert.rejects(normalizeEvidence(beyondLimit), { statusCode: 400 })
  const firstFrame = await image()
  const secondFrame = await sharp(firstFrame).negate().png().toBuffer()
  const animation = await sharp([firstFrame, secondFrame], { join: { animated: true } }).webp({ delay: [100, 100] }).toBuffer()
  assert.equal((await sharp(animation).metadata()).pages, 2)
  await assert.rejects(normalizeEvidence(animation), { statusCode: 400 })
})

async function storage(t) {
  const root = await mkdtemp(join(tmpdir(), 'salud-movimientos-'))
  const previous = process.env.PROFILE_PHOTO_DIR
  process.env.PROFILE_PHOTO_DIR = root
  t.after(async () => {
    if (previous === undefined) delete process.env.PROFILE_PHOTO_DIR
    else process.env.PROFILE_PHOTO_DIR = previous
    await rm(root, { recursive: true, force: true })
  })
  return root
}

test('new movement images use the verified email folder inside the configured server root', async (t) => {
  const root = await storage(t)
  const db = database(t, { verified: true })
  await uploadEvidence(7, 9, await image(), 'receipt.png')
  const reference = db.rows[0].archivo
  assert.match(reference, /^ana@example.com\/movimientos\/[a-f0-9-]{36}\.webp$/)
  assert.deepEqual((await readdir(join(root, 'ana@example.com'))).sort(), ['movimientos', 'perfil'])
  assert.ok((await readFile(join(root, reference))).length > 0)
  assert.equal((await getEvidence(8, 9, 1)).length > 0, true)
  await deleteEvidence(7, 9, 1)
  await assert.rejects(readFile(join(root, reference)), { code: 'ENOENT' })
})

test('verification prepares movement relocation and retains originals until the transaction commits', async (t) => {
  const root = await storage(t)
  const old = await writeEvidence(await normalizeEvidence(await image()), { id: 7 })
  const moved = await promoteMovementImages({
    execute: async (sql, params) => {
      if (sql.startsWith('SELECT correo')) return [[{ correo: 'ana@example.com' }]]
      if (sql.startsWith('SELECT e.id')) {
        assert.match(sql, /m.id_usuario = \? FOR UPDATE/)
        assert.deepEqual(params, [7])
        return [[{ id: 1, archivo: old }]]
      }
      assert.match(sql, /^UPDATE movimiento_evidencia SET archivo/)
      assert.equal(params[1], 1)
      return [{ affectedRows: 1 }]
    },
  }, 7)
  assert.equal(moved[0].old, old)
  assert.match(moved[0].next, /^ana@example.com\/movimientos\//)
  await readFile(join(root, old))
  await readFile(join(root, moved[0].next))
  await removeEvidenceFiles(moved.map((item) => item.old))
  await assert.rejects(readEvidence(old), { code: 'ENOENT' })
})

test('failed movement relocation removes destination copies but preserves source files', async (t) => {
  const root = await storage(t)
  const old = await writeEvidence(await normalizeEvidence(await image()), { id: 7 })
  await assert.rejects(promoteMovementImages({
    execute: async (sql) => {
      if (sql.startsWith('SELECT correo')) return [[{ correo: 'ana@example.com' }]]
      if (sql.startsWith('SELECT e.id')) return [[{ id: 1, archivo: old }]]
      throw new Error('Movement relocation failed')
    },
  }, 7), /Movement relocation failed/)
  await readEvidence(old)
  assert.deepEqual(await readdir(join(root, 'ana@example.com', 'movimientos')), [])
})

test('owner can upload/list/read/remove images independently without touching financial balances', async (t) => {
  const db = database(t)
  const result = await uploadEvidence(7, 9, await image(), 'recibo.png')
  const filename = db.rows[0].archivo
  t.after(() => removeEvidenceFiles([filename]))
  assert.equal(db.committed(), true)
  assert.match(filename, /^usuario-7\/movimientos\/[a-f0-9-]{36}\.webp$/)
  assert.deepEqual(result, { image: { id: 1, name: 'recibo.png' } })
  assert.deepEqual(await listEvidence(7, 9), { images: [{ id: 1, name: 'recibo.png' }], canManage: true })
  assert.equal((await sharp(await getEvidence(7, 9, 1)).metadata()).format, 'webp')
  await assert.rejects(getEvidence(7, 10, 1), { statusCode: 404 })
  await deleteEvidence(7, 9, 1)
  await assert.rejects(readEvidence(filename), { code: 'ENOENT' })
  assert.equal(db.rows.length, 0)
  assert.ok(db.calls.every(({ sql }) => !/UPDATE cuenta|INSERT INTO movimiento\s|UPDATE movimiento\s/.test(sql)))
})

test('family reads check current membership while mutations require ownership, not a supplied owner ID', async (t) => {
  const db = database(t, { owner: 7, viewer: 8 })
  assert.deepEqual(await listEvidence(8, 9), { images: [], canManage: false })
  const read = db.calls[0]
  assert.match(read.sql, /viewer.id_usuario = \? AND owner.id_usuario = m.id_usuario/)
  assert.match(read.sql, /owner.id_familia = viewer.id_familia/)
  assert.deepEqual(read.params, [9, 8, 8])
  await assert.rejects(uploadEvidence(8, 9, await image(), 'foto.png'), { statusCode: 404 })
  await assert.rejects(deleteEvidence(8, 9, 1), { statusCode: 404 })
  assert.ok(!db.calls.some(({ sql }) => sql.startsWith('INSERT') || sql.startsWith('DELETE')))
  t.mock.method(pool, 'execute', async () => [[]])
  await assert.rejects(listEvidence(8, 9), { statusCode: 404 })
  await assert.rejects(getEvidence(8, 9, 1), { statusCode: 404 })
})

test('upload count is locked and capped, and a failed database insert cleans up its newly written file', async (t) => {
  const full = database(t, { count: 5 })
  await assert.rejects(uploadEvidence(7, 9, await image(), 'foto.png'), { statusCode: 409 })
  assert.equal(full.rolledBack(), true)
  assert.ok(!full.calls.some(({ sql }) => sql.startsWith('INSERT')))
  const failing = database(t, { failInsert: true })
  await assert.rejects(uploadEvidence(7, 9, await image(), 'foto.png'), /insert failed/)
  const filename = failing.rows[0].archivo
  await assert.rejects(readEvidence(filename), { code: 'ENOENT' })
  assert.equal(failing.rolledBack(), true)
})

function request(method, buffer = Buffer.alloc(0), headers = {}) {
  const stream = Readable.from([buffer])
  stream.method = method
  stream.headers = headers
  return stream
}

test('evidence routes authenticate before reading a body; family mode and invalid formats are rejected', async (t) => {
  database(t)
  const url = new URL('http://localhost/api/movements/9/evidence')
  const helpers = { getUserId: async () => null, sendJson: () => assert.fail('Must not succeed') }
  assert.equal(await handleEvidenceRoute(request('POST'), {}, url, helpers), true)
  helpers.getUserId = async () => 7
  await assert.rejects(handleEvidenceRoute(request('POST'), {}, new URL(`${url}?view=family`), helpers), { statusCode: 403 })
  await assert.rejects(handleEvidenceRoute(request('POST', Buffer.from('fake'), { 'content-type': 'text/html' }), {}, url, helpers), { statusCode: 415 })
  await assert.rejects(handleEvidenceRoute(request('POST', Buffer.alloc(0), {
    'content-type': 'image/png', 'content-length': String(maxEvidenceBytes + 1),
  }), {}, url, helpers), { statusCode: 413 })
  await assert.rejects(handleEvidenceRoute(request('POST', Buffer.alloc(maxEvidenceBytes + 1), {
    'content-type': 'image/png',
  }), {}, url, helpers), { statusCode: 413 })
})

test('private image responses support GET/HEAD and forbid caching', async (t) => {
  const db = database(t)
  await handleEvidenceRoute(request('POST', await image(), {
    'content-type': 'image/png', 'x-file-name': encodeURIComponent('foto.png'),
  }), {}, new URL('http://localhost/api/movements/9/evidence'), {
    getUserId: async () => 7,
    sendJson: (response, status, payload) => {
      assert.equal(status, 201)
      assert.deepEqual(payload, { image: { id: 1, name: 'foto.png' } })
    },
  })
  t.after(() => removeEvidenceFiles([db.rows[0].archivo]))
  for (const method of ['GET', 'HEAD']) {
    const response = {
      writeHead(status, headers) { this.status = status; this.headers = headers },
      end(body) { this.body = body },
    }
    await handleEvidenceRoute(request(method), response, new URL('http://localhost/api/movements/9/evidence/1'), {
      getUserId: async () => 7, sendJson: () => assert.fail('Expected image'),
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers['Content-Type'], 'image/webp')
    assert.equal(response.headers['Cache-Control'], 'private, no-store')
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(response.headers['Cross-Origin-Resource-Policy'], 'same-origin')
    if (method === 'HEAD') assert.equal(response.body, undefined)
    else assert.ok(response.body.length > 0)
  }
  assert.throws(() => readEvidence('../.env'), /inválido/)
})

test('movement deletion removes evidence only after commit; a rollback preserves the files', async (t) => {
  const filename = await writeEvidence(await normalizeEvidence(await image()))
  t.after(() => removeEvidenceFiles([filename]))
  let fail = true
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => {}, rollback: async () => {}, release() {},
    commit: async () => { assert.ok((await readEvidence(filename)).length > 0) },
    execute: async (sql) => {
      if (sql.startsWith('SELECT') && sql.includes('FROM movimiento WHERE id =')) return [[{ id: 9, monto: '10' }]]
      if (sql.includes('FROM movimiento_evidencia')) return [[{ archivo: filename }]]
      if (sql.startsWith('DELETE FROM movimiento')) {
        if (fail) throw new Error('delete failed')
        return [{ affectedRows: 1 }]
      }
      assert.fail(sql)
    },
  }))
  await assert.rejects(deleteMovement(7, 9), /delete failed/)
  assert.ok((await readEvidence(filename)).length > 0)
  fail = false
  await deleteMovement(7, 9)
  await assert.rejects(readEvidence(filename), { code: 'ENOENT' })
})
