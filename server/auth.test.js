import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { after, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { pool } from './db.js'
import { isValidPhoto, themes } from '../shared/profile.js'

process.env.SESSION_SECRET = 'test-secret-for-profile-and-recovery-only'
const {
  authenticateUser, createSession, findSessionUser, getSessionUserId,
  recoverPassword, registerUser, updateProfile, updateTheme,
} = await import('./auth.js')
const { server } = await import('./index.js')
const photo = 'https://example.com/avatar.png'
const password = 'a-long-test-password'
const recoveryKey = 'UnaFrasePrivada'
const passwordHash = await bcrypt.hash(password, 4)
const recoveryHash = await bcrypt.hash(recoveryKey.toLowerCase(), 4)
const versionFor = (hash) => createHmac('sha256', process.env.SESSION_SECRET)
  .update(`session-password:${hash}`).digest('base64url')

after(async () => { await pool.end() })

test('photo validation permits only HTTPS URLs of up to 500 characters', () => {
  assert.equal(isValidPhoto(photo), true)
  for (const invalid of ['', null, 'http://example.com/a.png', 'javascript:alert(1)',
    'https://name:password@example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA']) {
    assert.equal(isValidPhoto(invalid), false, String(invalid))
  }
  const prefix = 'https://example.com/'
  assert.equal(isValidPhoto(prefix + 'a'.repeat(500 - prefix.length)), true)
  assert.equal(isValidPhoto(prefix + 'a'.repeat(501 - prefix.length)), false)
  assert.equal(isValidPhoto('data:image/jpeg;base64,/9j/AAAA'), false)
})

test('registration stores photo, theme and a hashed recovery key', async (t) => {
  let inserted
  let released = false
  t.mock.method(pool, 'getConnection', async () => ({
    execute: async (sql, params) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
      if (sql.startsWith('SELECT id')) return [[]]
      if (sql.startsWith('INSERT')) {
        assert.ok(sql.includes('recuperacion_token_hash, recuperacion_expira'))
        inserted = params
        return [{ insertId: 7 }]
      }
      if (sql.includes('RELEASE_LOCK')) return [[{}]]
      assert.fail(`Unexpected SQL: ${sql}`)
    },
    release: () => { released = true },
  }))
  const user = await registerUser(' Ana ', password, photo, recoveryKey, 'azul', ' Ana@Example.com ')
  assert.deepEqual(user, { id: 7, name: 'Ana', photo, theme: 'azul', appearance: 'day', email: 'ana@example.com', emailVerified: 0, role: 'free', sessionVersion: versionFor(inserted[1]) })
  assert.equal(inserted[6], 'ana@example.com')
  assert.equal(inserted[5], 'day')
  assert.equal(inserted[2], photo)
  assert.equal(inserted[3], 'azul')
  assert.notEqual(inserted[4], recoveryKey)
  assert.equal(await bcrypt.compare(recoveryKey.toLowerCase(), inserted[4]), true)
  assert.equal(await bcrypt.compare(password, inserted[1]), true)
  assert.equal(released, true)
})

test('registration rejects missing or invalid email, recovery keys and invalid themes before touching MySQL', async (t) => {
  const getConnection = t.mock.method(pool, 'getConnection', () => assert.fail('Unexpected connection'))
  await assert.rejects(registerUser('Ana', password, '', recoveryKey), { statusCode: 400 })
  await assert.rejects(registerUser('Ana', password, photo, '', 'verde', 'ana@example.com'), { statusCode: 400 })
  await assert.rejects(registerUser('Ana', password, photo, recoveryKey, 'invalid', 'ana@example.com'), { statusCode: 400 })
  assert.equal(getConnection.mock.callCount(), 0)
})

test('registration accepts an omitted photo and stores email as unverified without sending mail', async (t) => {
  let inserted
  t.mock.method(pool, 'getConnection', async () => ({
    execute: async (sql, params) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
      if (sql.includes('RELEASE_LOCK')) return [[{}]]
      if (sql.startsWith('SELECT id')) return [[]]
      assert.match(sql, /correo_verificado, rol\) VALUES.*0, 'free'\)/)
      inserted = params
      return [{ insertId: 40 }]
    },
    release() {},
  }))
  const user = await registerUser('Sin foto', password, null, recoveryKey, 'verde', 'nofoto@example.com')
  assert.equal(inserted[2], null)
  assert.equal(user.photo, null)
  assert.equal(user.emailVerified, 0)
})

test('registration reports duplicate emails without creating an account', async (t) => {
  t.mock.method(pool, 'getConnection', async () => ({
    execute: async (sql) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
      if (sql.includes('RELEASE_LOCK')) return [[{}]]
      if (sql.includes('WHERE nombre')) return [[]]
      if (sql.includes('WHERE correo')) return [[{ id: 1 }]]
      assert.fail('Must not insert')
    },
    release() {},
  }))
  await assert.rejects(registerUser('Otro', password, null, recoveryKey, 'verde', 'ana@example.com'), { statusCode: 409 })
})

test('login and restored sessions return saved profile fields without exposing hashes', async (t) => {
  t.mock.method(pool, 'execute', async (sql) => {
    if (sql.includes('WHERE nombre')) return [[{
      id: 7, nombre: 'Ana', password_hash: passwordHash, foto_perfil: photo, tema: 'violeta', appearance: 'night', email: 'ana@example.com', emailVerified: 1, role: 'admin',
    }]]
    assert.match(sql, /rol AS role/)
    return [[{ id: 7, name: 'Ana', photo, theme: 'violeta', appearance: 'night', hasRecoveryKey: 1, role: 'admin' }]]
  })
  assert.deepEqual(await authenticateUser('Ana', password), {
    id: 7, name: 'Ana', photo, theme: 'violeta', appearance: 'night', email: 'ana@example.com', emailVerified: 1, role: 'admin', sessionVersion: versionFor(passwordHash),
  })
  assert.deepEqual(await findSessionUser(7), { id: 7, name: 'Ana', photo, theme: 'violeta', appearance: 'night', hasRecoveryKey: 1, role: 'admin' })
  await assert.rejects(authenticateUser('Ana', 'wrong'), { statusCode: 401 })
})

test('all available themes persist independently of an existing profile photo', async (t) => {
  let savedTheme
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (sql.startsWith('UPDATE')) {
      assert.equal(sql, 'UPDATE usuario SET tema = ? WHERE id = ?')
      assert.equal(params[1], 7)
      savedTheme = params[0]
      return [{ affectedRows: 1 }]
    }
    return [[{ id: 7, name: 'Ana', photo: null, theme: savedTheme }]]
  })

  assert.equal(themes.length, 9)
  for (const { id } of themes) assert.equal((await updateTheme(7, id)).theme, id)
  await assert.rejects(updateTheme(7, 'invalid'), { statusCode: 400 })
})

test('login accepts a verified email or username and rejects ambiguous matches', async (t) => {
    let ambiguous = false
    t.mock.method(pool, 'execute', async (sql, params) => {
      assert.match(sql, /nombre = \? OR \(correo = \? AND correo_verificado = 1\)/)
      assert.deepEqual(params, ['Ana@Example.com', 'ana@example.com'])
      const user = { id: 7, nombre: 'Ana', password_hash: passwordHash, correo: 'ana@example.com' }
      return [ambiguous ? [user, { ...user, id: 8 }] : [user]]
    })
    assert.equal((await authenticateUser(' Ana@Example.com ', password)).id, 7)
    ambiguous = true
    await assert.rejects(authenticateUser('Ana@Example.com', password), { statusCode: 401 })
  })
test('appearance changes persist only the authenticated user mode and preserve the color', async (t) => {
  let appearance = 'day'
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (sql.startsWith('UPDATE')) {
      assert.equal(sql, 'UPDATE usuario SET apariencia = ? WHERE id = ?')
      assert.equal(params[1], 7)
      appearance = params[0]
      return [{ affectedRows: 1 }]
    }
    assert.match(sql, /apariencia AS appearance/)
    return [[{ id: 7, name: 'Ana', photo, theme: 'azul', appearance }]]
  })
  for (const mode of ['night', 'day']) {
    const user = await updateTheme(7, undefined, mode)
    assert.equal(user.appearance, mode)
    assert.equal(user.theme, 'azul')
  }
  for (const mode of ['dark', '', null, {}, 1]) {
    await assert.rejects(updateTheme(7, undefined, mode), { statusCode: 400 })
  }
  await assert.rejects(updateTheme(7), { statusCode: 400 })
})

test('profile photo updates preserve the recovery key when omitted', async (t) => {
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (sql.startsWith('UPDATE')) {
      assert.deepEqual(params, [photo, 'verde', 7])
      assert.doesNotMatch(sql, /recuperacion_/)
      return [{ affectedRows: 1 }]
    }
    return [[{ id: 7, name: 'Ana', photo, theme: 'verde' }]]
  })
  assert.equal((await updateProfile(7, { photo, theme: 'verde' })).photo, photo)
})

test('profile cannot change the recovery key outside the email flow', async (t) => {
  t.mock.method(pool, 'execute', () => assert.fail('Must not update directly'))
  await assert.rejects(updateProfile(7, { photo, theme: 'verde', recoveryKey, currentPassword: password }),
    { statusCode: 400, message: 'Solicita el enlace por correo para cambiar tu palabra clave.' })
})

test('profile renames the user without changing email, password or user id', async (t) => {
  let savedName = 'Ana'
  let released = false
  let unlocked = false
  t.mock.method(pool, 'getConnection', async () => ({
    execute: async (sql, params) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
      if (sql.includes('RELEASE_LOCK')) { unlocked = true; return [[{}]] }
      if (sql.startsWith('SELECT id')) {
        assert.match(sql, /correo_verificado = 1/)
        assert.deepEqual(params, ['Nueva Ana', 'nueva ana', 7])
        return [[]]
      }
      assert.equal(sql, 'UPDATE usuario SET nombre = ?, foto_perfil = ?, tema = ? WHERE id = ?')
      assert.deepEqual(params, ['Nueva Ana', null, 'verde', 7])
      savedName = params[0]
      return [{ affectedRows: 1 }]
    },
    release() { released = true },
  }))
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (sql.includes('WHERE nombre')) return [params[0] === savedName ? [{
      id: 7, nombre: savedName, password_hash: passwordHash, email: 'ana@example.com', emailVerified: 1,
    }] : []]
    return [[{ id: 7, name: savedName, photo: null, email: 'ana@example.com', emailVerified: 1 }]]
  })
  const user = await updateProfile(7, { name: ' Nueva Ana ', photo: null, theme: 'verde' })
  assert.equal(user.name, 'Nueva Ana')
  assert.equal(user.email, 'ana@example.com')
  assert.equal(user.id, 7)
  assert.ok(released && unlocked)
  assert.equal((await authenticateUser('Nueva Ana', password)).id, 7)
  await assert.rejects(authenticateUser('Ana', password), { statusCode: 401 })
})

test('renaming rejects occupied names or verified emails and releases the registration lock', async (t) => {
  let released = false
  let unlocked = false
  t.mock.method(pool, 'getConnection', async () => ({
    execute: async (sql) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
      if (sql.includes('RELEASE_LOCK')) { unlocked = true; return [[{}]] }
      if (sql.startsWith('SELECT id')) return [[{ id: 8 }]]
      assert.fail('Must not update an occupied name')
    },
    release() { released = true },
  }))
  await assert.rejects(updateProfile(7, { name: 'Ocupado', photo, theme: 'verde' }), { statusCode: 409 })
  assert.ok(released && unlocked)
})

test('invalid usernames are rejected before acquiring a connection', async (t) => {
  t.mock.method(pool, 'getConnection', () => assert.fail('Must validate first'))
  for (const name of ['', '   ', 'a'.repeat(101), 123]) {
    await assert.rejects(updateProfile(7, { name, photo, theme: 'verde' }), { statusCode: 400 })
  }
})

test('recovery validates the secret, changes the password and invalidates earlier sessions', async (t) => {
  let currentHash = passwordHash
  let savedPasswordHash
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (sql.startsWith('SELECT password_hash')) return [[{ password_hash: currentHash }]]
    if (sql.startsWith('SELECT id, recuperacion_token_hash')) {
      assert.ok(sql.includes('recuperacion_expira > CURRENT_TIMESTAMP'))
      return [[{ id: 7, recuperacion_token_hash: recoveryHash, password_hash: passwordHash }]]
    }
    assert.ok(sql.startsWith('UPDATE usuario SET password_hash = ? WHERE'))
    assert.ok(sql.includes('recuperacion_expira > CURRENT_TIMESTAMP'))
    assert.deepEqual(params.slice(1), [7, passwordHash, recoveryHash])
    savedPasswordHash = params[0]
    currentHash = savedPasswordHash
    return [{ affectedRows: 1 }]
  })
  const oldRequest = { headers: { cookie: `salud_financiera_session=${createSession(7, versionFor(passwordHash))}` } }
  assert.equal(await getSessionUserId(oldRequest), 7)
  await recoverPassword('recovery-success', `  ${recoveryKey.toUpperCase()} `, 'my-new-long-password', 'test-success-ip')
  assert.equal(await bcrypt.compare('my-new-long-password', savedPasswordHash), true)
  assert.equal(await getSessionUserId(oldRequest), null)
  const newRequest = { headers: { cookie: `salud_financiera_session=${createSession(7, versionFor(savedPasswordHash))}` } }
  assert.equal(await getSessionUserId(newRequest), 7)
})

test('unknown users, users without a key and incorrect keys have the same recovery error', async (t) => {
  let rows = []
  t.mock.method(pool, 'execute', async (sql) => {
    assert.ok(sql.startsWith('SELECT'))
    return [rows]
  })
  const expected = { statusCode: 400, message: 'El usuario o la palabra clave no son correctos.' }
  await assert.rejects(recoverPassword('missing', recoveryKey, password, 'missing-ip'), expected)
  rows = [{ id: 7, recuperacion_token_hash: null }]
  await assert.rejects(recoverPassword('legacy', recoveryKey, password, 'legacy-ip'), expected)
  rows = [{ id: 7, recuperacion_token_hash: recoveryHash }]
  await assert.rejects(recoverPassword('wrong-key', 'incorrect-key', password, 'wrong-key-ip'), expected)
  rows = [{ id: 7, recuperacion_token_hash: 'a'.repeat(64) }]
  await assert.rejects(recoverPassword('legacy-token', recoveryKey, password, 'legacy-token-ip'), expected)
})

test('recovery limits attempts per user and per IP', async (t) => {
  t.mock.method(pool, 'execute', async () => [[]])
  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(recoverPassword('rate-user', recoveryKey, password, `rate-user-ip-${index}`), { statusCode: 400 })
  }
  await assert.rejects(recoverPassword('rate-user', recoveryKey, password, 'rate-user-ip-next'), { statusCode: 429 })
  for (let index = 0; index < 10; index += 1) {
    await assert.rejects(recoverPassword(`rate-ip-user-${index}`, recoveryKey, password, 'rate-ip'), { statusCode: 400 })
  }
  await assert.rejects(recoverPassword('rate-ip-next', recoveryKey, password, 'rate-ip'), { statusCode: 429 })
})

test('profile and theme API require a valid session and store photo URLs', async (t) => {
  const prefix = 'https://example.com/'
  const photoUrl = prefix + 'a'.repeat(500 - prefix.length)
  let savedPhoto
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (sql.startsWith('SELECT password_hash')) return [[{ password_hash: passwordHash }]]
    if (sql.startsWith('UPDATE')) {
      savedPhoto = params[0]
      return [{ affectedRows: 1 }]
    }
    return [[{ id: 7, name: 'Ana', photo: savedPhoto, theme: 'verde' }]]
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const base = `http://127.0.0.1:${server.address().port}`
  for (const [method, path] of [
    ['PUT', '/api/auth/profile'], ['PUT', '/api/auth/theme'], ['GET', '/api/auth/me'],
    ['GET', '/api/dashboard'], ['GET', '/api/calendar'], ['POST', '/api/accounts'],
    ['PUT', '/api/accounts/1'], ['DELETE', '/api/accounts/1'],
    ['POST', '/api/subscriptions'], ['PUT', '/api/subscriptions/1'], ['DELETE', '/api/subscriptions/1'],
    ['POST', '/api/plans'], ['PUT', '/api/plans/1'], ['DELETE', '/api/plans/1'],
    ['POST', '/api/movements'], ['PUT', '/api/movements/1'], ['DELETE', '/api/movements/1'],
  ]) {
    const unauthorized = await fetch(`${base}${path}`, { method })
    assert.equal(unauthorized.status, 401)
  }
  const response = await fetch(`${base}/api/auth/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: `salud_financiera_session=${createSession(7, versionFor(passwordHash))}` },
    body: JSON.stringify({ photo: photoUrl, theme: 'verde' }),
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).user.photo, photoUrl)
  for (const invalidPhoto of [`${photoUrl}a`, 'data:image/jpeg;base64,/9j/AAAA']) {
    const invalid = await fetch(`${base}/api/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `salud_financiera_session=${createSession(7, versionFor(passwordHash))}` },
      body: JSON.stringify({ photo: invalidPhoto, theme: 'verde' }),
    })
    assert.equal(invalid.status, 400)
    assert.equal(savedPhoto, photoUrl)
  }
  const me = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: `salud_financiera_session=${createSession(7, versionFor(passwordHash))}` },
  })
  assert.equal(me.status, 200)
  assert.equal((await me.json()).user.photo, photoUrl)
})

test('HTTP recovery revokes the old cookie and login issues a usable new-version cookie', async (t) => {
  const user = {
    id: 21, nombre: 'http-user', password_hash: passwordHash, recuperacion_token_hash: recoveryHash,
    foto_perfil: photo, tema: 'oscuro',
  }
  t.mock.method(pool, 'execute', async (sql, params) => {
    if (sql.startsWith('SELECT password_hash')) return [[{ password_hash: user.password_hash }]]
    if (sql.startsWith('UPDATE usuario SET password_hash')) {
      user.password_hash = params[0]
      return [{ affectedRows: 1 }]
    }
    if (sql.includes('WHERE nombre')) return [[{ ...user }]]
    return [[{ id: user.id, name: user.nombre, photo: user.foto_perfil, theme: user.tema }]]
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const login = await post('/api/auth/login', { name: user.nombre, password })
  assert.equal(login.status, 200)
  const oldCookie = login.headers.get('set-cookie').split(';')[0]
  assert.equal((await login.json()).user.photo, photo)
  const recovery = await post('/api/auth/recover', { name: user.nombre, recoveryKey, password: 'a-new-http-password' })
  assert.equal(recovery.status, 200)
  assert.equal((await recovery.json()).ok, true)
  const oldSession = await fetch(`${base}/api/auth/me`, { headers: { Cookie: oldCookie } })
  assert.equal(oldSession.status, 401)
  const newLogin = await post('/api/auth/login', { name: user.nombre, password: 'a-new-http-password' })
  assert.equal(newLogin.status, 200)
  const newCookie = newLogin.headers.get('set-cookie').split(';')[0]
  const newSession = await fetch(`${base}/api/auth/me`, { headers: { Cookie: newCookie } })
  assert.equal(newSession.status, 200)
  const restored = await newSession.json()
  assert.equal(restored.user.theme, 'oscuro')
  assert.equal(restored.user.photo, photo)
})
