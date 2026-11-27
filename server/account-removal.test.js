import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { pool } from './db.js'
import { removeAccountInformation, handleAccountRemovalRoute, cleanPendingAccountFiles } from './account-removal.js'
import { describeSharedMovement } from '../saludFinanciera/server/movement-sharing.js'
import { movementLabel } from '../saludFinanciera/movement-labels.js'
import { saveMovement, deleteMovement } from '../saludFinanciera/server/movements.js'
import { getDashboardData } from '../saludFinanciera/server/dashboard.js'
import { getCalendarData } from '../saludFinanciera/server/calendar.js'
import { listEvidence, deleteEvidence } from './evidence.js'

after(() => pool.end())
const password = 'a-valid-test-password'
const hash = await bcrypt.hash(password, 4)
const confirm = { confirm: true, confirmPermanent: true, password }

function database(t, overrides = {}) {
  const state = {
    users: [{ id: 2, rol: 'admin', password_hash: hash }, { id: 6, rol: 'free', password_hash: hash, foto_perfil: '/api/profile-photo/6/usuario-6/11111111-1111-4111-8111-111111111111.webp' }],
    movements: [
      { id: 1, id_usuario: 6, id_usuario_destino: null },
      { id: 2, id_usuario: 6, id_usuario_destino: 9, id_cuenta_origen: 60, id_cuenta_destino: 90, monto: '50' },
      { id: 3, id_usuario: 9, id_usuario_destino: 6, id_cuenta_origen: 90, id_cuenta_destino: 60, monto: '20' },
    ],
    balances: { 60: '100', 90: '900' }, statements: [], committed: false, rolledBack: false, released: false,
    ...overrides,
  }
  const execute = async (sql, params = []) => {
    state.statements.push([sql, params])
    if (state.fail?.(sql)) throw new Error('transaction failed')
    if (sql.startsWith('SELECT id, password_hash')) return [state.users]
    if (sql.startsWith('SELECT e.archivo')) return [[{ archivo: '11111111-1111-4111-8111-111111111111.webp' }]]
    if (sql.startsWith('UPDATE movimiento SET id_usuario')) {
      for (const movement of state.movements.filter((row) => row.id_usuario === params[0] && row.id_usuario_destino)) {
        Object.assign(movement, { id_usuario: movement.id_usuario_destino, id_cuenta_origen: null, id_usuario_destino: null, archivo_familiar: 'recibida' })
      }
    } else if (sql.startsWith('UPDATE movimiento SET id_cuenta_destino')) {
      for (const movement of state.movements.filter((row) => row.id_usuario_destino === params[0])) {
        Object.assign(movement, { id_cuenta_destino: null, id_usuario_destino: null, archivo_familiar: 'enviada' })
      }
    } else if (sql === 'DELETE FROM movimiento WHERE id_usuario = ?') {
      state.movements = state.movements.filter((row) => row.id_usuario !== params[0])
    }
    return [{ affectedRows: 1 }]
  }
  let snapshot
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => { snapshot = structuredClone(state.movements) },
    execute,
    commit: async () => { state.committed = true },
    rollback: async () => { state.rolledBack = true; state.movements = snapshot },
    release: () => { state.released = true },
  }))
  t.mock.method(pool, 'execute', async (sql) => {
    assert.ok(state.committed, 'File cleanup must happen only after commit')
    if (sql.startsWith('SELECT id, tipo')) return [[]]
    if (sql.startsWith('SELECT COUNT')) return [[{ count: 0 }]]
    assert.fail(sql)
  })
  return state
}

test('clearing data preserves login and profile, dissolves/unlinks family and removes only owned financial records', async (t) => {
  const state = database(t)
  const result = await removeAccountInformation(6, 6, confirm)
  assert.deepEqual(result, { ok: true, deleted: false, warning: '' })
  assert.ok(state.committed && state.released && !state.rolledBack)
  const sql = state.statements.map(([query]) => query).join('\n')
  for (const table of ['movimiento', 'prestamo', 'plan_futuro', 'suscripciones', 'cuenta', 'usuario_enlace_correo']) {
    assert.ok(sql.includes(`DELETE FROM ${table} WHERE id_usuario = ?`))
  }
  assert.ok(sql.includes('DELETE FROM familia WHERE id_creador = ?'))
  assert.ok(sql.includes('DELETE FROM familia_integrante WHERE id_usuario = ?'))
  assert.doesNotMatch(sql, /DELETE FROM usuario WHERE|UPDATE cuenta|DELETE FROM categorias|catalogo_tarjeta/)
  assert.ok(state.statements.filter(([query]) => query.startsWith('DELETE FROM')).every(([, params]) => params[0] === 6))
  assert.equal(state.statements.filter(([query]) => query.includes("VALUES ('perfil'")).length, 0)
})

test('shared movements keep only the surviving participant side with no balance change or personal counterparty name', async (t) => {
  const state = database(t)
  await removeAccountInformation(6, 6, confirm)
  assert.deepEqual(state.balances, { 60: '100', 90: '900' })
  assert.equal(state.movements.length, 2)
  assert.deepEqual(state.movements.map((row) => [row.id, row.id_usuario, row.id_usuario_destino, row.archivo_familiar]), [
    [2, 9, null, 'recibida'], [3, 9, null, 'enviada'],
  ])
  assert.equal(state.movements[0].id_cuenta_origen, null)
  assert.equal(state.movements[0].id_cuenta_destino, 90)
  assert.equal(state.movements[1].id_cuenta_origen, 90)
  assert.equal(state.movements[1].id_cuenta_destino, null)
  for (const direction of ['enviada', 'recibida']) {
    const movement = describeSharedMovement({ archivedFamily: direction, originAccount: 'Origen', destinationAccount: 'Destino' }, 9)
    assert.equal(movement.canEdit, false)
    assert.equal(movementLabel(movement), 'Transferencia familiar · Historial conservado')
    assert.equal(direction === 'enviada' ? movement.destinationAccount : movement.originAccount, 'Cuenta desvinculada')
  }
})

test('admin deletion and self deletion use the same transaction, queue photo removal and delete user last', async (t) => {
  for (const actor of [2, 6]) {
    const state = database(t)
    assert.equal((await removeAccountInformation(actor, 6, confirm, true)).deleted, true)
    assert.match(state.statements.at(-1)[0], /^DELETE FROM usuario WHERE id = \?$/)
    assert.deepEqual(state.statements.at(-1)[1], [6])
    assert.ok(state.statements.some(([sql]) => sql.includes("VALUES ('perfil'")))
    t.mock.restoreAll()
  }
})

test('protected ID, missing confirmations and invalid credentials cannot start destructive SQL', async (t) => {
  const state = database(t)
  for (const roleInput of [
    { ...confirm, confirm: false }, { ...confirm, confirmPermanent: false }, { ...confirm, password: '' },
  ]) await assert.rejects(removeAccountInformation(6, 6, roleInput, true), { statusCode: 400 })
  await assert.rejects(removeAccountInformation(2, 2, confirm, true), { statusCode: 403 })
  assert.equal(state.statements.length, 0)
  await assert.rejects(removeAccountInformation(6, 6, { ...confirm, password: 'wrong-password' }, true), { statusCode: 403 })
  assert.ok(state.rolledBack)
  assert.ok(state.statements.every(([sql]) => sql.startsWith('SELECT')))
})

test('actor role is rechecked under lock and a missing target is reported without deletion', async (t) => {
  const state = database(t)
  state.users[0].rol = 'free'
  await assert.rejects(removeAccountInformation(2, 6, confirm, true), { statusCode: 403 })
  state.users[0].rol = 'admin'
  state.users.pop()
  await assert.rejects(removeAccountInformation(2, 6, confirm, true), { statusCode: 404 })
  assert.ok(state.statements.every(([sql]) => sql.startsWith('SELECT')))
})

test('failure rolls back shared history conversion and all deletions before any file cleanup', async (t) => {
  const state = database(t, { fail: (sql) => sql === 'DELETE FROM cuenta WHERE id_usuario = ?' })
  const before = structuredClone(state.movements)
  await assert.rejects(removeAccountInformation(6, 6, confirm, true), /transaction failed/)
  assert.deepEqual(state.movements, before)
  assert.ok(state.rolledBack && state.released && !state.committed)
  assert.equal(pool.execute.mock.callCount(), 0)
})

test('routes authenticate and authorize administrators before reading the deletion body', async (t) => {
  const options = { getUserId: async () => null, readJson: () => assert.fail('Unexpected body read'), sendJson: () => {} }
  for (const [pathname, method] of [['/api/auth/clear-data', 'POST'], ['/api/auth/account', 'DELETE'], ['/api/admin/users/6', 'DELETE']]) {
    assert.equal(await handleAccountRemovalRoute({ method }, {}, new URL(`http://localhost${pathname}`), options), true)
  }
  t.mock.method(pool, 'execute', async () => [[{ rol: 'free' }]])
  await assert.rejects(handleAccountRemovalRoute({ method: 'DELETE' }, {}, new URL('http://localhost/api/admin/users/6'), {
    ...options, getUserId: async () => 6,
  }), { statusCode: 403 })
})

test('self routes ignore a forged target ID and permanent deletion clears the current session cookie', async (t) => {
  for (const [pathname, method, deleted] of [['/api/auth/clear-data', 'POST', false], ['/api/auth/account', 'DELETE', true]]) {
    const state = database(t)
    let cookie
    let payload
    await handleAccountRemovalRoute({ method }, { setHeader: (name, value) => { if (name === 'Set-Cookie') cookie = value } },
      new URL(`http://localhost${pathname}`), {
        getUserId: async () => 6,
        readJson: async () => ({ ...confirm, userId: 2, id: 2 }),
        sendJson: (_response, status, result) => { assert.equal(status, 200); payload = result },
      })
    assert.equal(payload.deleted, deleted)
    assert.deepEqual(state.statements[0][1], [6, 6])
    assert.equal(Boolean(cookie?.includes('Max-Age=0')), deleted)
    t.mock.restoreAll()
  }
})

test('archived shared history cannot be edited or deleted via forged movement requests', async (t) => {
  let rolledBack = 0
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => {},
    execute: async (sql) => {
      assert.match(sql, /^SELECT.*archivo_familiar.*FOR UPDATE$/)
      return [[{ id: 8, archivo_familiar: 'recibida' }]]
    },
    rollback: async () => { rolledBack++ }, release: () => {},
  }))
  await assert.rejects(saveMovement(9, { operation: 'income', amount: '20' }, 8), { statusCode: 403 })
  await assert.rejects(deleteMovement(9, 8), { statusCode: 403 })
  assert.equal(rolledBack, 2)
})

test('preserved history remains outside income/expenses and counts as a credit-card payment', async (t) => {
  const queries = []
  t.mock.method(pool, 'execute', async (sql) => { queries.push(sql); return [[]] })
  await getDashboardData(9)
  await getCalendarData(9, '2026-11')
  const payments = queries.find((sql) => sql.includes('AS paymentTransfers'))
  assert.match(payments, /payment.id_cuenta_origen IS NOT NULL OR payment.archivo_familiar = 'recibida'/)
  for (const sql of queries.filter((query) => query.includes('AS income') && query.includes('AS expenses'))) {
    assert.match(sql, /m.archivo_familiar IS NULL AND m.id_prestamo IS NULL AND \(cat.tipo = 'ingreso'/)
    assert.match(sql, /m.archivo_familiar IS NULL AND m.id_prestamo IS NULL AND (?:m.id_plan_futuro IS NULL AND )?\(cat.tipo = 'gasto'/)
  }
})

test('preserved evidence is readable but cannot be changed by the surviving account', async (t) => {
  const execute = async (sql) => {
    if (sql.includes('AS ownerId')) return [[{ ownerId: 9, archivedFamily: 'enviada' }]]
    if (sql.startsWith('SELECT id, nombre')) return [[{ id: 8, name: 'Comprobante' }]]
    assert.fail(sql)
  }
  t.mock.method(pool, 'execute', execute)
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => {}, execute, rollback: async () => {}, release: () => {},
  }))
  assert.deepEqual(await listEvidence(9, 3), { images: [{ id: 8, name: 'Comprobante' }], canManage: false })
  await assert.rejects(deleteEvidence(9, 3, 8), { statusCode: 403 })
})

test('pending file cleanup removes only recorded safe references and retains failed work', async (t) => {
  const deletes = []
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (sql.startsWith('SELECT id, tipo')) return [[{ id: 3, tipo: 'evidencia', referencia: `${randomUUID()}.webp` }]]
    if (sql.startsWith('DELETE')) { deletes.push(params[0]); return [{ affectedRows: 1 }] }
    return [[{ count: 0 }]]
  })
  assert.equal(await cleanPendingAccountFiles(), 0)
  assert.deepEqual(deletes, [3])
})

test('cleanup retains failed file references persistently and never recursively removes a directory', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sf-removal-'))
  const previous = process.env.PROFILE_PHOTO_DIR
  process.env.PROFILE_PHOTO_DIR = directory
  t.after(async () => {
    if (previous === undefined) delete process.env.PROFILE_PHOTO_DIR
    else process.env.PROFILE_PHOTO_DIR = previous
    await rm(directory, { recursive: true, force: true })
  })
  const name = `${randomUUID()}.webp`
  await mkdir(path.join(directory, 'usuario-6', 'movimientos', name), { recursive: true })
  t.mock.method(pool, 'execute', async (sql) => {
    if (sql.startsWith('SELECT id, tipo')) return [[{ id: 3, tipo: 'evidencia', referencia: `usuario-6/movimientos/${name}` }]]
    if (sql.startsWith('SELECT COUNT')) return [[{ count: 1 }]]
    assert.fail('Failed file cleanup must retain its queue row')
  })
  assert.equal(await cleanPendingAccountFiles(), 1)
})

test('cleanup processes more than one batch instead of leaving files after the first hundred', async (t) => {
  let removed = 0
  const entries = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, tipo: 'evidencia', referencia: `${randomUUID()}.webp` }))
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (sql.startsWith('SELECT id, tipo')) return [entries.filter((entry) => entry.id > params[0]).slice(0, 100)]
    if (sql.startsWith('DELETE')) { removed++; return [{ affectedRows: 1 }] }
    return [[{ count: 101 - removed }]]
  })
  assert.equal(await cleanPendingAccountFiles(), 0)
  assert.equal(removed, 101)
})

test('migration protects the primary admin and records shared-history status and persistent file cleanup', async () => {
  const sql = await readFile(new URL('./migrations/017-account-removal.sql', import.meta.url), 'utf8')
  assert.match(sql, /archivo_familiar ENUM\('enviada', 'recibida'\) NULL DEFAULT NULL/)
  assert.match(sql, /CREATE TABLE archivo_borrado_pendiente/)
  assert.match(sql, /BEFORE DELETE ON usuario/)
  assert.match(sql, /IF OLD.id = 2 THEN/)
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE|DROP TABLE/)
})
