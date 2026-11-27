import assert from 'node:assert/strict'
import { test } from 'node:test'

const components = new Map()
globalThis.customElements = { define: (name, component) => components.set(name, component) }
await import('./account-removal.js')
const removal = components.get('account-removal').prototype
const methods = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(removal))
  .filter(([, descriptor]) => typeof descriptor.value === 'function').map(([name, descriptor]) => [name, descriptor.value]))
const state = (changes = {}) => ({
  ...methods, userId: 6, userName: 'Ana', admin: false, action: '', step: 0, busy: false, error: '',
  renderRoot: { querySelectorAll: () => [] }, ...changes,
})
function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('profile has separate clear and delete actions and explains retained profile, family and external balances', () => {
  const ctx = state()
  ctx.begin('clear')
  const clear = text(ctx.render())
  assert.match(clear, /Borrar información/)
  assert.match(clear, /Eliminar cuenta definitivamente/)
  assert.match(clear, /Se conservarán el usuario, contraseña, correo, foto, tema y rol/)
  assert.match(clear, /Si la creó, se disolverá la familia/)
  assert.match(clear, /sin modificar su saldo/)
  assert.match(clear, /respaldos previos del servidor no se modifican/)
  ctx.begin('delete')
  const deletion = text(ctx.render())
  assert.match(deletion, /id="removal-first"/)
  assert.match(deletion, /id="removal-final"/)
  assert.match(deletion, /También se eliminarán el perfil, foto, correo, rol y acceso/)
  assert.match(deletion, /Última confirmación/)
  assert.match(deletion, /No, conservar cuenta/)
})

test('first deletion confirmation only opens second dialog and cancel never sends a request', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Deletion requires the second confirmation'))
  const ctx = state()
  ctx.begin('delete')
  assert.equal(ctx.step, 1)
  await ctx.submit({ preventDefault: () => {} })
  assert.equal(ctx.step, 2)
  ctx.cancel()
  assert.equal(ctx.step, 0)
  await ctx.submit({ preventDefault: () => {} })
  assert.equal(ctx.step, 0)
})

test('data clearing makes one authenticated request; permanent deletion requires stage two and both confirmations', async (t) => {
  t.mock.method(globalThis, 'FormData', function () { return { get: () => 'current-password' } })
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ ok: true, deleted: options.method === 'DELETE', warning: '' }))
  })
  for (const [action, admin, url, method] of [
    ['clear', false, '/api/auth/clear-data', 'POST'],
    ['delete', false, '/api/auth/account', 'DELETE'],
    ['delete', true, '/api/admin/users/6', 'DELETE'],
  ]) {
    let event
    const ctx = state({ action, step: action === 'clear' ? 1 : 2, admin, dispatchEvent: (value) => { event = value } })
    await ctx.submit({ preventDefault: () => {}, currentTarget: {} })
    assert.equal(requests.at(-1).url, url)
    assert.equal(requests.at(-1).options.method, method)
    assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
      password: 'current-password', confirm: true, confirmPermanent: action === 'delete',
    })
    assert.equal(event.type, 'account-removed')
    assert.equal(event.detail.id, 6)
    assert.equal(ctx.step, 0)
  }
})

test('deletion error retains the final dialog and never announces success', async (t) => {
  t.mock.method(globalThis, 'FormData', function () { return { get: () => 'wrong-password' } })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Contraseña incorrecta' }), { status: 403 }))
  const ctx = state({ action: 'delete', step: 2, dispatchEvent: () => assert.fail('No success event') })
  await ctx.submit({ preventDefault: () => {}, currentTarget: {} })
  assert.equal(ctx.step, 2)
  assert.equal(ctx.busy, false)
  assert.equal(ctx.error, 'Contraseña incorrecta')
})

test('protected primary administrator cannot use delete action but retains clear-data action', () => {
  const ctx = state({ userId: 2 })
  const template = ctx.render()
  const profile = template.values.find((value) => value?.strings && text(value).includes('Borrar información y cuenta'))
  assert.match(text(profile), /El administrador ID 2 no se puede eliminar/)
  const buttons = profile.strings.join('')
  assert.match(buttons, /Eliminar cuenta definitivamente/)
  assert.ok(profile.values.includes(true), 'Delete button is disabled for ID 2')
  ctx.admin = true
  const administrator = ctx.render().values.find((value) => value?.strings && text(value).includes('Eliminar usuario'))
  assert.equal(administrator.values[0], true)
})
