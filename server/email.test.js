import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import bcrypt from 'bcryptjs'
import nodemailer from 'nodemailer'
import { pool } from './db.js'
import { requestEmailLink, consumeEmailLink, handleEmailRoute, sendAccountEmail, requestPublicRecovery, authorizePasswordRecovery, checkRecoveryEmail } from './email.js'

const password = 'a-long-test-password'
const passwordHash = await bcrypt.hash(password, 4)

test('Gmail transport builds an HTTPS single-use fragment link from configuration without real email delivery', async (t) => {
  const keys = ['APP_BASE_URL', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'SMTP_PORT', 'SMTP_SECURE']
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
  })
  Object.assign(process.env, {
    APP_BASE_URL: 'https://lifekit.work', SMTP_USER: 'sender@example.com',
    SMTP_PASSWORD: 'dummy-app-password', SMTP_FROM: 'sender@example.com', SMTP_PORT: '465', SMTP_SECURE: 'true',
  })
  let closed = false
  let generated = false
  let resetPassword = false
  t.mock.method(nodemailer, 'createTransport', (config) => {
    assert.equal(config.secure, true)
    assert.equal(config.port, 465)
    assert.equal(config.auth.pass, 'dummy-app-password')
    return {
      sendMail: async (message) => {
        assert.equal(message.to, 'ana@example.com')
        if (resetPassword) {
          assert.match(message.subject, /Recupera tu contraseña/)
          assert.match(message.text, /#reset-password=/)
          assert.match(message.text, /nueva contraseña de acceso/)
        } else if (generated) {
          assert.match(message.subject, /Tu nueva palabra clave/)
          assert.match(message.text, /\n\nnew-generated-key\n\n/)
          assert.doesNotMatch(message.text, /#recovery-key=|Caduca en 30 minutos/)
        } else {
          assert.match(message.text, /https:\/\/lifekit.work\/#verify-email=/)
          assert.match(message.text, /30 minutos/)
        }
        assert.doesNotMatch(message.text, /dummy-app-password/)
        return { accepted: ['ana@example.com'], rejected: [] }
      },
      close: () => { closed = true },
    }
  })
  await sendAccountEmail('ana@example.com', 'verify-email', 'c'.repeat(64))
  assert.equal(closed, true)
  generated = true
  await sendAccountEmail('ana@example.com', 'recovery-key', 'new-generated-key')
  resetPassword = true
  await sendAccountEmail('ana@example.com', 'reset-password', 'd'.repeat(64))
  process.env.APP_BASE_URL = 'http://untrusted.example'
  await assert.rejects(sendAccountEmail('ana@example.com', 'verify-email', 'c'.repeat(64)), /HTTPS/)
})

function database(t, execute) {
  const state = { committed: false, rolledBack: false, released: false, writes: [] }
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => {},
    commit: async () => { state.committed = true },
    rollback: async () => { state.rolledBack = true },
    release: () => { state.released = true },
    execute: async (sql, params) => {
      state.writes.push({ sql, params })
      assert.equal((sql.match(/\?/g) || []).length, params.length)
      if (sql.includes('FROM movimiento_evidencia e')) return [[]]
      if (sql.includes('INTERVAL 1770 SECOND')) return [[]]
      return execute(sql, params)
    },
  }))
  return state
}

test('verification stores only a hashed, expiring token; validates password and normalizes the unique address', async (t) => {
  let tokenHash
  const state = database(t, async (sql, params) => {
    if (sql.startsWith('SELECT')) return [[{ password_hash: passwordHash }]]
    if (sql.startsWith('INSERT')) {
      assert.match(sql, /INTERVAL 30 MINUTE/)
      tokenHash = params[2]
      assert.equal(params[3], 'ana@example.com')
    }
    return [{ affectedRows: 1 }]
  })
  let sent
  const result = await requestEmailLink(101, 'verify-email', { email: ' Ana@Example.com ', currentPassword: password },
    async (email, purpose, token) => { sent = { email, purpose, token } })
  assert.equal(sent.purpose, 'verify-email')
  assert.equal(tokenHash, createHash('sha256').update(sent.token).digest('hex'))
  assert.notEqual(sent.token, tokenHash)
  assert.equal(JSON.stringify(result).includes(sent.token), false)
  assert.equal(state.committed, true)
  assert.equal(state.released, true)
})

test('duplicate address, wrong password and invalid email are explicit and cannot send mail', async (t) => {
  const state = database(t, async (sql) => {
    if (sql.startsWith('SELECT')) return [[{ password_hash: passwordHash }]]
    throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
  })
  const send = () => assert.fail('Must not send')
  await assert.rejects(requestEmailLink(102, 'verify-email', { email: 'ana@example.com', currentPassword: password }, send),
    { statusCode: 409, message: 'Ya hay una cuenta registrada con ese correo.' })
  await assert.rejects(requestEmailLink(102, 'verify-email', { email: 'ana@example.com', currentPassword: 'wrong' }, send), { statusCode: 400 })
  await assert.rejects(requestEmailLink(102, 'verify-email', { email: 'bad\r\nemail', currentPassword: password }, send), { statusCode: 400 })
  assert.equal(state.rolledBack, true)
})

test('recovery requires verified email and SMTP failure rolls back the replacement token', async (t) => {
  let verified = 0
  const state = database(t, async (sql) => sql.startsWith('SELECT')
    ? [[{ correo: 'ana@example.com', correo_verificado: verified }]] : [{ affectedRows: 1 }])
  await assert.rejects(requestEmailLink(103, 'reset-recovery', {}, () => assert.fail('Not verified')), { statusCode: 400 })
  verified = 1
  t.mock.method(console, 'error', () => {})
  await assert.rejects(requestEmailLink(103, 'reset-recovery', {}, async () => { throw new Error('SMTP failed') }), { statusCode: 503 })
  assert.equal(state.committed, false)
  assert.equal(state.rolledBack, true)
})

test('generated recovery keys are emailed only to verified addresses and stored exclusively as hashes', async (t) => {
  let verified = 0
  let stored
  let cooldown
  const state = database(t, async (sql, params) => {
    if (sql.startsWith('SELECT')) return [[{ correo: 'ana@example.com', correo_verificado: verified }]]
    if (sql.startsWith('INSERT')) {
      assert.equal(params[1], 'reset-recovery')
      cooldown = params[2]
    }
    if (sql.startsWith('UPDATE')) {
      assert.doesNotMatch(sql, /password_hash/)
      assert.match(sql, /recuperacion_expira = NULL/)
      stored = params[0]
    }
    return [{ affectedRows: 1 }]
  })
  await assert.rejects(requestEmailLink(120, 'recovery-key', {}, () => assert.fail('Not verified')), { statusCode: 400 })
  verified = 1
  let sent
  const result = await requestEmailLink(120, 'recovery-key', {}, async (email, purpose, key) => {
    assert.equal(email, 'ana@example.com')
    assert.equal(purpose, 'recovery-key')
    assert.match(key, /^[a-f0-9]{24}$/)
    assert.equal(await bcrypt.compare(key, stored), true)
    sent = key
  })
  assert.equal(state.committed, true)
  assert.equal(result.retryAfterSeconds, 30)
  assert.equal(JSON.stringify(result).includes(sent), false)
  assert.equal(JSON.stringify(state.writes).includes(sent), false)
  assert.notEqual(cooldown, createHash('sha256').update(sent).digest('hex'))
})

test('SMTP failure rolls back a generated recovery key instead of claiming it was sent', async (t) => {
  const state = database(t, async (sql) => sql.startsWith('SELECT')
    ? [[{ correo: 'ana@example.com', correo_verificado: 1 }]] : [{ affectedRows: 1 }])
  t.mock.method(console, 'error', () => {})
  await assert.rejects(requestEmailLink(121, 'recovery-key', {}, async () => { throw new Error('SMTP failed') }), { statusCode: 503 })
  assert.equal(state.committed, false)
  assert.equal(state.rolledBack, true)
  assert.equal(state.released, true)
})

test('consuming a recovery token updates a bcrypt hash, deletes token and prevents expired or reused links', async (t) => {
  let valid = true
  let stored
  const state = database(t, async (sql, params) => {
    if (sql.startsWith('SELECT id_usuario')) return [[{ id_usuario: 7 }]]
    if (sql.startsWith('SELECT id FROM usuario')) return [[{ id: 7 }]]
    if (sql.startsWith('SELECT e.id_usuario')) {
      assert.match(sql, /expira > UTC_TIMESTAMP\(\)/)
      assert.match(sql, /u.correo = e.correo/)
      assert.match(sql, /FOR UPDATE/)
      return [valid ? [{ id_usuario: 7 }] : []]
    }
    if (sql.startsWith('UPDATE')) stored = params[0]
    if (sql.startsWith('DELETE')) valid = false
    return [{ affectedRows: 1 }]
  })
  const input = { token: 'a'.repeat(64), recoveryKey: ' NuevaClave ' }
  await consumeEmailLink('reset-recovery', input, 'test-1')
  assert.equal(await bcrypt.compare('nuevaclave', stored), true)
  assert.equal(state.committed, true)
  await assert.rejects(consumeEmailLink('reset-recovery', input, 'test-1'), { statusCode: 400 })
  await assert.rejects(consumeEmailLink('reset-recovery', { ...input, token: 'bad' }, 'test-1'), { statusCode: 400 })
  assert.equal(state.writes.filter(({ sql }) => sql.startsWith('UPDATE')).length, 1)
})

test('verification only verifies the bound address and authenticated sends never read unauthenticated bodies', async (t) => {
  const state = database(t, async (sql) => {
    if (sql.startsWith('SELECT')) return [[{ id_usuario: 7 }]]
    return [{ affectedRows: 1 }]
  })

  await consumeEmailLink('verify-email', { token: 'b'.repeat(64) }, 'test-2')
  assert.ok(state.writes.some(({ sql }) => sql.includes('SET correo_verificado = 1')))
  assert.equal(await handleEmailRoute({ method: 'POST' }, {}, new URL('http://localhost/api/auth/email/send-recovery'), {
    getUserId: async () => null, readJson: () => assert.fail('Must authenticate first'), sendJson: () => assert.fail('Must authenticate first'),
  }), true)
})

test('verified addresses cannot be replaced even with a correct password', async (t) => {
    const state = database(t, async () => [[{
      correo: 'ana@example.com', correo_verificado: 1, password_hash: passwordHash,
    }]])
    await assert.rejects(requestEmailLink(110, 'verify-email', {
      email: 'different@example.com', currentPassword: password,
    }, () => assert.fail('Must not send')), { statusCode: 409 })
    assert.equal(state.writes.some(({ sql }) => sql.startsWith('UPDATE')), false)
  })

test('resend cooldown is enforced under the user lock before any token replacement or email', async (t) => {
    let sent = 0
    t.mock.method(pool, 'getConnection', async () => ({
      beginTransaction: async () => {}, rollback: async () => {}, release() {},
      execute: async (sql) => {
        if (sql.includes('FROM usuario WHERE')) return [[{ correo: 'ana@example.com', correo_verificado: 1 }]]
        assert.match(sql, /INTERVAL 1770 SECOND/)
        return [[{ id_usuario: 111 }]]
      },
    }))
    await assert.rejects(requestEmailLink(111, 'reset-recovery', {}, async () => { sent++ }), { statusCode: 429 })
    await assert.rejects(requestEmailLink(111, 'recovery-key', {}, async () => { sent++ }), { statusCode: 429 })
    assert.equal(sent, 0)
  })

test('public recovery sends only to a stored verified email and responds identically for missing accounts', async (t) => {
  let found = true
  t.mock.method(pool, 'execute', async (sql, params) => {
    assert.match(sql, /correo = \? AND correo_verificado = 1/)
    assert.deepEqual(params, ['ana@example.com'])
    return [found ? [{ id: 130 }] : []]
  })
  const state = database(t, async (sql) => sql.startsWith('SELECT')
    ? [[{ correo: 'ana@example.com', correo_verificado: 1 }]] : [{ affectedRows: 1 }])
  let deliveries = 0
  const send = async (email, purpose, token) => {
    assert.equal(email, 'ana@example.com')
    assert.ok(['reset-password', 'reset-recovery'].includes(purpose))
    assert.match(token, /^[a-f0-9]{64}$/)
    deliveries++
  }
  const known = await requestPublicRecovery({ email: ' Ana@Example.com ', purpose: 'reset-password' }, 'public-1', send)
  await requestPublicRecovery({ email: 'ana@example.com', purpose: 'reset-recovery' }, 'public-1', send)
  found = false
  const missing = await requestPublicRecovery({ email: 'ana@example.com', purpose: 'reset-password' }, 'public-2', send)
  assert.deepEqual(known, missing)
  assert.equal(deliveries, 2)
  assert.ok(state.committed)
  assert.equal(JSON.stringify(known).includes('token'), false)
  assert.equal(state.writes.some(({ sql }) => sql.startsWith('UPDATE usuario')), false)
})

test('public recovery rejects unsupported purposes and surfaces SMTP errors', async (t) => {
  await assert.rejects(requestPublicRecovery({ email: 'bad', purpose: 'reset-password' }, 'public-invalid'), { statusCode: 400 })
  await assert.rejects(requestPublicRecovery({ email: 'ana@example.com', purpose: 'recovery-key' }, 'public-invalid'), { statusCode: 400 })
  t.mock.method(pool, 'execute', async () => [[{ id: 131 }]])
  database(t, async (sql) => sql.startsWith('SELECT')
    ? [[{ correo: 'ana@example.com', correo_verificado: 1 }]] : [{ affectedRows: 1 }])
  t.mock.method(console, 'error', () => {})
  await assert.rejects(requestPublicRecovery({ email: 'ana@example.com', purpose: 'reset-password' }, 'public-smtp',
    async () => { throw new Error('SMTP failed') }), { statusCode: 503 })
})

test('validating email and key grants a short-lived hashed one-use password reset token without changing the password', async (t) => {
  const recoveryHash = await bcrypt.hash('private-key', 4)
  let savedToken
  const state = database(t, async (sql, params) => {
    if (sql.startsWith('SELECT')) {
      assert.match(sql, /correo_verificado = 1/)
      assert.match(sql, /recuperacion_expira/)
      assert.match(sql, /FOR UPDATE/)
      assert.deepEqual(params, ['ana@example.com'])
      return [[{ id: 132, correo: 'ana@example.com', recuperacion_token_hash: recoveryHash }]]
    }
    assert.match(sql, /INTERVAL 10 MINUTE/)
    assert.match(sql, /'reset-password'/)
    savedToken = params[1]
    return [{ affectedRows: 1 }]
  })
  const result = await authorizePasswordRecovery({ email: ' Ana@Example.com ', recoveryKey: ' Private-Key ' }, 'key-valid')
  assert.match(result.token, /^[a-f0-9]{64}$/)
  assert.equal(savedToken, createHash('sha256').update(result.token).digest('hex'))
  assert.ok(state.committed)
  assert.equal(state.writes.some(({ sql }) => sql.startsWith('UPDATE')), false)
})

test('wrong keys, missing or unverified accounts never receive a password reset token', async (t) => {
  const hash = await bcrypt.hash('correct-key', 4)
  let missing = false
  const state = database(t, async (sql) => {
    assert.match(sql, /^SELECT/)
    return [missing ? [] : [{ id: 133, correo: 'ana@example.com', recuperacion_token_hash: hash }]]
  })
  await assert.rejects(authorizePasswordRecovery({ email: 'ana@example.com', recoveryKey: 'wrong-key' }, 'key-wrong'), { statusCode: 400 })
  missing = true
  await assert.rejects(authorizePasswordRecovery({ email: 'missing@example.com', recoveryKey: 'correct-key' }, 'key-missing'), { statusCode: 400 })
  assert.ok(state.rolledBack)
  assert.equal(state.writes.some(({ sql }) => sql.startsWith('INSERT')), false)
})

test('password reset consumes only its verified-email-bound token, hashes password and rejects replay', async (t) => {
  let valid = true
  let stored
  const state = database(t, async (sql, params) => {
    if (sql.startsWith('SELECT id_usuario')) {
      assert.equal(params[1], 'reset-password')
      return [[{ id_usuario: 134 }]]
    }
    if (sql.startsWith('SELECT id FROM usuario')) return [[{ id: 134 }]]
    if (sql.startsWith('SELECT e.id_usuario')) {
      assert.match(sql, /e.expira > UTC_TIMESTAMP/)
      assert.match(sql, /u.correo = e.correo/)
      assert.match(sql, /u.correo_verificado = 1/)
      return [valid ? [{ id_usuario: 134 }] : []]
    }
    if (sql.startsWith('UPDATE')) {
      assert.equal(sql, 'UPDATE usuario SET password_hash = ? WHERE id = ?')
      stored = params[0]
    }
    if (sql.startsWith('DELETE')) valid = false
    return [{ affectedRows: 1 }]
  })
  const input = { token: 'd'.repeat(64), password: 'a-brand-new-password' }
  await assert.rejects(consumeEmailLink('reset-password', { ...input, password: 'short' }, 'password-invalid'), { statusCode: 400 })
  await consumeEmailLink('reset-password', input, 'password-valid')
  assert.equal(await bcrypt.compare(input.password, stored), true)
  assert.ok(state.committed)
  await assert.rejects(consumeEmailLink('reset-password', input, 'password-replay'), { statusCode: 400 })
  assert.equal(state.writes.filter(({ sql }) => sql.startsWith('UPDATE')).length, 1)
})

test('public recovery routes work without a session and never expose account information', async (t) => {
  t.mock.method(pool, 'execute', async () => [[]])
  let response
  const handled = await handleEmailRoute({ method: 'POST', socket: { remoteAddress: 'public-route' } }, {},
    new URL('http://localhost/api/auth/email/request-access-link'), {
      getUserId: () => assert.fail('Public recovery must not require login'),
      readJson: async () => ({ email: 'missing@example.com', purpose: 'reset-password' }),
      sendJson: (_, status, payload) => { assert.equal(status, 200); response = payload },
    })

    test('email precheck accepts only existing verified addresses and returns no account details', async (t) => {
      let found = true
      t.mock.method(pool, 'execute', async (sql, params) => {
        assert.equal(sql, 'SELECT id FROM usuario WHERE correo = ? AND correo_verificado = 1')
        assert.deepEqual(params, ['precheck@example.com'])
        return [found ? [{ id: 150 }] : []]
      })
      assert.deepEqual(await checkRecoveryEmail({ email: ' Precheck@Example.com ' }, 'check-test'),
        { ok: true, email: 'precheck@example.com' })
      found = false
      await assert.rejects(checkRecoveryEmail({ email: 'precheck@example.com' }, 'check-test'),
        { statusCode: 400, message: 'No hay una cuenta con ese correo verificado. Revisa la dirección o verifica tu correo desde Mi perfil.' })
      await assert.rejects(checkRecoveryEmail({ email: 'bad' }, 'check-test'), { statusCode: 400 })
    })

    test('email precheck is rate limited before further database lookups', async (t) => {
      const execute = t.mock.method(pool, 'execute', async () => [[{ id: 151 }]])
      for (let index = 0; index < 5; index++) {
        await checkRecoveryEmail({ email: `limit-${index}@example.com` }, 'check-limit')
      }
      await assert.rejects(checkRecoveryEmail({ email: 'sixth@example.com' }, 'check-limit'), { statusCode: 429 })
      assert.equal(execute.mock.callCount(), 5)
    })
  assert.equal(handled, true)
  assert.equal(response.retryAfterSeconds, 30)
  assert.match(response.message, /^Si el correo/)
  assert.deepEqual(Object.keys(response).sort(), ['message', 'ok', 'retryAfterSeconds'])
})
