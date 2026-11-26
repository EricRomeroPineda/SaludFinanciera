import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import sharp from 'sharp'
import { pool } from './db.js'
import { handleProfilePhotoRoute, promoteProfilePhoto, removeProfilePhoto, uploadProfilePhoto } from './profile-photo.js'
import { updateProfile } from './auth.js'
import { consumeEmailLink } from './email.js'
import { writeEvidence, readEvidence } from './evidence-files.js'

const image = await sharp({ create: { width: 1000, height: 900, channels: 3, background: '#4488aa' } }).png().toBuffer()

async function setup(t, verified = 0) {
  const root = await mkdtemp(join(tmpdir(), 'salud-profile-'))
  const previous = process.env.PROFILE_PHOTO_DIR
  process.env.PROFILE_PHOTO_DIR = root
  t.after(async () => {
    if (previous === undefined) delete process.env.PROFILE_PHOTO_DIR
    else process.env.PROFILE_PHOTO_DIR = previous
    await rm(root, { recursive: true, force: true })
  })
  const state = { root, user: { foto_perfil: 'https://example.com/old.png', correo: 'ana@example.com', correo_verificado: verified }, images: [], writes: [], committed: false, rolledBack: false, fail: false }
  const connection = {
    beginTransaction: async () => {},
    commit: async () => { state.committed = true },
    rollback: async () => { state.rolledBack = true },
    release() {},
    execute: async (sql, params) => {
      state.writes.push({ sql, params })
      if (sql.includes('FROM movimiento_evidencia e')) return [state.images]
      if (sql.startsWith('SELECT')) return [[{ ...state.user, id: 7, id_usuario: 7 }]]
      if (state.fail) throw new Error('Database write failed')
      if (sql.startsWith('UPDATE usuario SET foto_perfil')) state.user.foto_perfil = params[0]
      if (sql.startsWith('UPDATE movimiento_evidencia')) state.images.find((image) => image.id === params[1]).archivo = params[0]
      return [{ affectedRows: 1 }]
    },
  }
  t.mock.method(pool, 'getConnection', async () => connection)
  t.mock.method(pool, 'execute', connection.execute)
  return { state, connection }
}

function diskPath(root, photo) {
  const parts = photo.split('/')
  return join(root, decodeURIComponent(parts[4]), 'perfil', parts[5])
}

test('unverified uploads are optimized in a user folder and move to the verified email folder', async (t) => {
  const { state, connection } = await setup(t)
  const first = await uploadProfilePhoto(7, image)
  assert.match(first, /^\/api\/profile-photo\/7\/usuario-7\//)
  assert.deepEqual((await readdir(join(state.root, 'usuario-7'))).sort(), ['movimientos', 'perfil'])
  const metadata = await sharp(await readFile(diskPath(state.root, first))).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.width, 800)
  assert.equal(state.committed, true)
  assert.match(state.writes[0].sql, /FOR UPDATE/)
  const moved = await promoteProfilePhoto(connection, 7)
  assert.equal(moved.old, first)
  assert.match(moved.photo, /ana%40example.com/)
  await readFile(join(state.root, 'ana@example.com', 'perfil', moved.photo.split('/').at(-1)))
  await removeProfilePhoto(moved.old)
  await assert.rejects(readFile(diskPath(state.root, first)), { code: 'ENOENT' })
  state.user.correo_verificado = 1
  const next = await uploadProfilePhoto(7, image)
  assert.match(next, /ana%40example.com/)
  await assert.rejects(readFile(diskPath(state.root, moved.photo)), { code: 'ENOENT' })
})

test('failed database update removes the new file and retains the existing photo', async (t) => {
  const { state } = await setup(t, 1)
  const first = await uploadProfilePhoto(7, image)
  state.fail = true
  await assert.rejects(uploadProfilePhoto(7, image), /Database write failed/)
  assert.equal(state.rolledBack, true)
  await readFile(diskPath(state.root, first))
  assert.equal((await readdir(join(state.root, 'ana@example.com', 'perfil'))).length, 1)
})

test('consuming email verification promotes the photo and deletes the temporary file after commit', async (t) => {
  const { state } = await setup(t)
  const before = await uploadProfilePhoto(7, image)
  const evidence = await writeEvidence(image, { id: 7 })
  state.images.push({ id: 9, archivo: evidence })
  await consumeEmailLink('verify-email', { token: 'e'.repeat(64) }, 'profile-photo-verification')
  assert.match(state.user.foto_perfil, /ana%40example.com/)
  await readFile(diskPath(state.root, state.user.foto_perfil))
  await assert.rejects(readFile(diskPath(state.root, before)), { code: 'ENOENT' })
  assert.equal(state.writes.some(({ sql }) => sql.includes('SET correo_verificado = 1')), true)
  assert.match(state.images[0].archivo, /^ana@example.com\/movimientos\//)
  await readEvidence(state.images[0].archivo)
  await assert.rejects(readEvidence(evidence), { code: 'ENOENT' })
})

test('failed verification retains the temporary photo and removes the promoted copy', async (t) => {
  const { state, connection } = await setup(t)
  const before = await uploadProfilePhoto(7, image)
  const evidence = await writeEvidence(image, { id: 7 })
  state.images.push({ id: 9, archivo: evidence })
  const execute = connection.execute
  connection.execute = async (sql, params) => {
    if (sql.includes('SET correo_verificado = 1')) throw new Error('Verification update failed')
    return execute(sql, params)
  }
  await assert.rejects(consumeEmailLink('verify-email', { token: 'f'.repeat(64) }, 'profile-photo-failed'), /Verification update failed/)
  assert.equal(state.rolledBack, true)
  await readFile(diskPath(state.root, before))
  assert.deepEqual(await readdir(join(state.root, 'ana@example.com', 'perfil')), [])
  await readEvidence(evidence)
  assert.deepEqual(await readdir(join(state.root, 'ana@example.com', 'movimientos')), [])
})

test('invalid, oversized or disguised images cannot reach storage', async (t) => {
  const { state } = await setup(t)
  for (const buffer of [Buffer.from('<svg></svg>'), Buffer.alloc(5 * 1024 * 1024 + 1)]) {
    await assert.rejects(uploadProfilePhoto(7, buffer), (error) => [400, 413].includes(error.statusCode))
  }
  assert.deepEqual(await readdir(state.root), [])
  assert.equal(state.writes.length, 0)
})

test('photo routes require a session, enforce ownership and serve only the current photo', async (t) => {
  const { state } = await setup(t, 1)
  const photo = await uploadProfilePhoto(7, image)
  const request = { method: 'GET' }
  await handleProfilePhotoRoute(request, {}, new URL(photo, 'http://localhost'), {
    getUserId: async () => null, sendJson: () => assert.fail('Must authenticate'),
  })
  await assert.rejects(handleProfilePhotoRoute(request, {}, new URL(photo, 'http://localhost'), {
    getUserId: async () => 8,
  }), { statusCode: 403 })
  let headers
  let body
  await handleProfilePhotoRoute(request, {
    writeHead(status, value) { assert.equal(status, 200); headers = value },
    end(value) { body = value },
  }, new URL(photo, 'http://localhost'), { getUserId: async () => 7 })
  assert.equal(headers['Cache-Control'], 'private, no-store')
  assert.equal(headers['Content-Type'], 'image/webp')
  assert.ok(body.length > 0)
  state.user.foto_perfil = null
  await assert.rejects(handleProfilePhotoRoute(request, {}, new URL(photo, 'http://localhost'), {
    getUserId: async () => 7,
  }), { statusCode: 404 })
})

test('upload route validates MIME and returns the persisted reference', async (t) => {
  await setup(t)
  const url = new URL('http://localhost/api/auth/photo')
  const bad = Readable.from([image])
  bad.method = 'POST'
  bad.headers = { 'content-type': 'text/html' }
  await assert.rejects(handleProfilePhotoRoute(bad, {}, url, { getUserId: async () => 7 }), { statusCode: 415 })
  const request = Readable.from([image])
  request.method = 'POST'
  request.headers = { 'content-type': 'image/png' }
  let result
  await handleProfilePhotoRoute(request, {}, url, {
    getUserId: async () => 7,
    sendJson(_, status, value) { assert.equal(status, 201); result = value },
  })
  assert.match(result.photo, /usuario-7/)
})

test('profile updates cannot attach an arbitrary private photo reference', async (t) => {
  await setup(t)
  const photo = `/api/profile-photo/8/usuario-8/${'a'.repeat(36)}.webp`
  await assert.rejects(updateProfile(7, { photo, theme: 'verde' }), { statusCode: 400 })
})
