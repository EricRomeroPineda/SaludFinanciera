import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { pool } from './db.js'
import { handleUserRolesRoute } from './user-roles.js'

after(() => pool.end())
const url = (suffix = '') => new URL(`http://localhost/api/admin/users${suffix}`)
const options = (body = {}) => ({
  getUserId: async () => 2, readJson: async () => body,
  sendJson: (response, status, payload) => Object.assign(response, { status, payload }),
})

test('all account administration requires a live admin role before reading input', async (t) => {
  let role = 'free'
  t.mock.method(pool, 'execute', async (sql, params) => {
    assert.equal(sql, 'SELECT rol FROM usuario WHERE id = ?')
    assert.deepEqual(params, [2])
    return [[{ rol: role }]]
  })
  for (role of ['free', 'vip', 'usuario', undefined]) {
    for (const [method, suffix] of [['GET', ''], ['PUT', '/7/role']]) {
      await assert.rejects(handleUserRolesRoute({ method }, {}, url(suffix), {
        ...options(), readJson: () => assert.fail('Must authorize first'),
      }), { statusCode: 403 })
    }
  }
  assert.equal(await handleUserRolesRoute({}, {}, url(), { ...options(), getUserId: async () => null }), true)
  assert.equal(await handleUserRolesRoute({}, {}, new URL('http://localhost/api/dashboard'), options()), false)
})

test('user list projects names, IDs and roles only', async (t) => {
  t.mock.method(pool, 'execute', async (sql) => {
    if (sql.startsWith('SELECT rol')) return [[{ rol: 'admin' }]]
    assert.equal(sql, 'SELECT id, nombre AS name, rol AS role FROM usuario ORDER BY nombre, id')
    return [[{ id: 2, name: 'Admin', role: 'admin' }]]
  })
  const response = {}
  await handleUserRolesRoute({ method: 'GET' }, response, url(), options())
  assert.deepEqual(response.payload, { users: [{ id: 2, name: 'Admin', role: 'admin' }] })
})

test('admin can assign each valid role while the ID 2 cannot be demoted, even by itself', async (t) => {
  const updates = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (sql.startsWith('SELECT rol')) return [[{ rol: 'admin' }]]
    assert.equal(sql, 'UPDATE usuario SET rol = ? WHERE id = ?')
    updates.push(params)
    return [{ affectedRows: 1 }]
  })
  for (const role of ['admin', 'free', 'vip']) {
    const response = {}
    await handleUserRolesRoute({ method: 'PUT' }, response, url('/7/role'), options({ role }))
    assert.deepEqual(response.payload, { id: 7, role })
  }
  for (const role of ['free', 'vip']) {
    await assert.rejects(handleUserRolesRoute({ method: 'PUT' }, {}, url('/2/role'), options({ role })), { statusCode: 403 })
  }
  assert.equal(updates.length, 3)
  await handleUserRolesRoute({ method: 'PUT' }, {}, url('/2/role'), options({ role: 'admin' }))
  assert.deepEqual(updates[3], ['admin', 2])
})

test('invalid roles and IDs never update users; missing users return 404', async (t) => {
  t.mock.method(pool, 'execute', async (sql) => sql.startsWith('SELECT rol') ? [[{ rol: 'admin' }]] : [{ affectedRows: 0 }])
  for (const role of ['usuario', 'ADMIN', '', null, {}, ['admin']]) {
    await assert.rejects(handleUserRolesRoute({ method: 'PUT' }, {}, url('/7/role'), options({ role })), { statusCode: 400 })
  }
  await assert.rejects(handleUserRolesRoute({ method: 'PUT' }, {}, url('/99999999999999999999/role'), options({ role: 'free' })), { statusCode: 400 })
  await assert.rejects(handleUserRolesRoute({ method: 'PUT' }, {}, url('/7/role'), options({ role: 'vip' })), { statusCode: 404 })
})

test('migration converts legacy normal users to Free and protects admin 2 without touching financial data', async () => {
  const sql = await readFile(new URL('./migrations/016-user-account-roles.sql', import.meta.url), 'utf8')
  assert.match(sql, /DEFAULT 'free'/)
  assert.match(sql, /SET rol = 'free' WHERE rol = 'usuario' AND id <> 2/)
  assert.match(sql, /SET rol = 'admin' WHERE id = 2/)
  assert.match(sql, /ENUM\('admin', 'free', 'vip'\)/)
  assert.match(sql, /CREATE TRIGGER proteger_admin_principal[\s\S]*BEFORE UPDATE ON usuario/)
  assert.match(sql, /OLD.id = 2/)
  assert.match(sql, /SIGNAL SQLSTATE '45000'/)
  assert.doesNotMatch(sql, /\b(cuenta|movimiento|suscripciones|plan_futuro)\b/)
})
