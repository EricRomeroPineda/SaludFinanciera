import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { pool } from './db.js'
import {
  createFamily, dissolveFamily, getFamily, handleFamilyRoute, inviteFamily,
  joinFamily, leaveFamily, removeFamilyMember, renameFamily,
} from './family.js'

function mockTransaction(t, execute) {
  const lifecycle = []
  t.mock.method(pool, 'getConnection', async () => ({
    execute,
    beginTransaction: async () => lifecycle.push('begin'),
    commit: async () => lifecycle.push('commit'),
    rollback: async () => lifecycle.push('rollback'),
    release: () => lifecycle.push('release'),
  }))
  return lifecycle
}

test('family reads only the authenticated membership and never returns authentication secrets', async (t) => {
  const calls = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    calls.push({ sql, params })
    return sql.includes('SELECT f.id')
      ? [[{ id: 4, name: 'Familia Luna', creatorId: 7 }]]
      : [[{ id: 7, name: 'Ana' }, { id: 8, name: 'Luis' }]]
  })
  const { family } = await getFamily(7)
  assert.equal(family.isOwner, true)
  assert.deepEqual(calls.map((call) => call.params), [[7], [4]])
  assert.match(calls[0].sql, /WHERE i.id_usuario = \?/)
  assert.match(calls[1].sql, /SELECT u.id, u.nombre AS name/)
  assert.equal(family.members.length, 2)
})

test('creating a family atomically links its creator and validates the name', async (t) => {
  const calls = []
  const lifecycle = mockTransaction(t, async (sql, params) => {
    calls.push({ sql, params })
    return sql.startsWith('INSERT INTO familia ') ? [{ insertId: 4 }] : [[]]
  })
  await createFamily(7, { name: ' Familia Luna ' })
  assert.deepEqual(calls.at(-1).params, [4, 7])
  assert.deepEqual(calls.at(-2).params, ['Familia Luna', 7])
  assert.match(calls[0].sql, /usuario.*FOR UPDATE/)
  assert.deepEqual(lifecycle, ['begin', 'commit', 'release'])
  for (const name of ['', 'a'.repeat(101)]) {
    await assert.rejects(createFamily(7, { name }), { statusCode: 400 })
  }
})

test('a user already in a family cannot create a second membership', async (t) => {
  const lifecycle = mockTransaction(t, async (sql) => {
    if (sql.startsWith('SELECT id_familia')) return [[{ id_familia: 4 }]]
    assert.match(sql, /^SELECT/)
    return [[]]
  })
  await assert.rejects(createFamily(7, { name: 'Otra' }), { statusCode: 409 })
  assert.deepEqual(lifecycle, ['begin', 'rollback', 'release'])
})

test('invitations store only a hash, expire in 24 hours and replace previous invitations', async (t) => {
  const calls = []
  mockTransaction(t, async (sql, params) => {
    calls.push({ sql, params })
    return [[{ id: 4 }]]
  })
  const first = await inviteFamily(7)
  const second = await inviteFamily(7)
  assert.match(first.code, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(first.code, second.code)
  const insert = calls[2]
  assert.deepEqual(insert.params, [createHash('sha256').update(first.code).digest('hex'), 4])
  assert.match(insert.sql, /INTERVAL 24 HOUR/)
  assert.match(calls[1].sql, /DELETE FROM familia_invitacion WHERE id_familia = \?/)
  assert.equal(JSON.stringify(calls).includes(first.code), false)
})

test('accepting an invitation locks and consumes it in the same transaction as the new membership', async (t) => {
  const calls = []
  const lifecycle = mockTransaction(t, async (sql, params) => {
    calls.push({ sql, params })
    return sql.includes('FROM familia_invitacion') || sql.startsWith('SELECT id FROM familia WHERE id =')
      ? [[{ id: 4 }]] : [[]]
  })
  await joinFamily(8, { code: 'a'.repeat(43) })
  assert.match(calls[1].sql, /SELECT id FROM familia WHERE id = \? FOR UPDATE/)
  assert.match(calls[2].sql, /vence_en > UTC_TIMESTAMP\(\) FOR UPDATE/)
  assert.deepEqual(calls.at(-2).params, [4, 8])
  assert.match(calls.at(-1).sql, /DELETE FROM familia_invitacion WHERE codigo_hash = \?/)
  assert.deepEqual(lifecycle, ['begin', 'commit', 'release'])
})

test('invalid, expired and reused invitations never create membership', async (t) => {
  mockTransaction(t, async (sql) => {
    assert.match(sql, /^SELECT/)
    return [[]]
  })
  await assert.rejects(joinFamily(8, { code: 'wrong' }), { statusCode: 400 })
  await assert.rejects(joinFamily(8, { code: 'a'.repeat(43) }), { statusCode: 409 })
})

test('only the creator can invite, rename, remove members or dissolve', async (t) => {
  mockTransaction(t, async (sql) => {
    assert.match(sql, /SELECT id FROM familia WHERE id_creador = \? FOR UPDATE/)
    return [[]]
  })

  for (const action of [
    () => inviteFamily(8), () => renameFamily(8, { name: 'Familia' }),
    () => removeFamilyMember(8, 7), () => dissolveFamily(8),
  ]) await assert.rejects(action(), { statusCode: 403 })
})

test('an invitation invalidated while waiting for the family lock cannot be accepted', async (t) => {
  const lifecycle = mockTransaction(t, async (sql) => {
    assert.doesNotMatch(sql, /^INSERT|^DELETE/)
    if (sql.startsWith('SELECT id_familia AS id')) return [[{ id: 4 }]]
    if (sql.startsWith('SELECT id FROM familia')) return [[{ id: 4 }]]
    assert.match(sql, /vence_en > UTC_TIMESTAMP\(\) FOR UPDATE/)
    return [[]]
  })
  await assert.rejects(joinFamily(8, { code: 'a'.repeat(43) }), { statusCode: 409 })
  assert.deepEqual(lifecycle, ['begin', 'rollback', 'release'])
})

test('leaving/removing/dissolving only changes family relationships, never financial records', async (t) => {
  const calls = []
  let owner = false
  mockTransaction(t, async (sql, params) => {
    calls.push({ sql, params })
    if (sql.startsWith('SELECT id FROM familia')) return [owner ? [{ id: 4 }] : []]
    return [{ affectedRows: 1 }]
  })
  await leaveFamily(8)
  owner = true
  await removeFamilyMember(7, 8)
  assert.deepEqual(calls.at(-1).params, [4, 8])
  await dissolveFamily(7)
  await assert.rejects(leaveFamily(7), { statusCode: 409 })
  await assert.rejects(removeFamilyMember(7, 7), { statusCode: 400 })
  assert.ok(calls.every(({ sql }) => !/cuenta|movimiento|suscripciones|plan_futuro/.test(sql)))
})

test('failed membership insertion rolls back the transaction instead of consuming the invitation', async (t) => {
  const lifecycle = mockTransaction(t, async (sql) => {
    if (sql.includes('FROM familia_invitacion') || sql.startsWith('SELECT id FROM familia WHERE id =')) return [[{ id: 4 }]]
    if (sql.startsWith('INSERT')) throw new Error('write failed')
    assert.doesNotMatch(sql, /^DELETE/)
    return [[]]
  })
  await assert.rejects(joinFamily(8, { code: 'a'.repeat(43) }), /write failed/)
  assert.deepEqual(lifecycle, ['begin', 'rollback', 'release'])
})

test('every family route requires an authenticated user before reading the body', async () => {
  for (const [method, path] of [
    ['GET', ''], ['POST', ''], ['PUT', ''], ['DELETE', ''],
    ['POST', '/join'], ['POST', '/invitations'], ['DELETE', '/membership'], ['DELETE', '/members/8'],
  ]) {
    assert.equal(await handleFamilyRoute({ method }, {}, new URL(`http://localhost/api/family${path}`), {
      getUserId: async () => null,
      readJson: () => assert.fail('Unauthenticated body'),
      sendJson: () => assert.fail('Unauthenticated response'),
    }), true)
  }
})
