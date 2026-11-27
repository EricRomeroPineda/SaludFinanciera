import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css?inline') || url.endsWith('.svg')) return { format: 'module', source: 'export default ""', shortCircuit: true }
    return next(url, context)
  },
})
const components = new Map()
globalThis.customElements = { define: (name, component) => components.set(name, component) }
await import('../../src/inicio/inicio.js')
const image = components.get('card-catalog-image').prototype
const admin = components.get('card-catalog-admin').prototype
const inicio = components.get('inicio-app').prototype
const finance = components.get('salud-financiera').prototype
const { invalidateCardImages } = await import('./card-catalog-image.js')
function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('menu entry and administrative screen are available only to admins, without nested buttons', () => {
  const normal = { user: { role: 'usuario' }, renderHeader: () => '', openFinancialSection: () => {} }
  const markup = text(inicio.renderMenu.call(normal))
  assert.doesNotMatch(markup, /Agregar info de tarjetas nuevas/)
  const administrator = text(inicio.renderMenu.call({ ...normal, user: { role: 'admin' } }))
  assert.match(administrator, /<article class="section-menu-card">/)
  assert.match(administrator, /Agregar info de tarjetas nuevas/)
  assert.match(administrator, /Entrar →/)
  assert.doesNotMatch(administrator, /<button class="section-menu-card"/)
  const blocked = text(inicio.render.call({ ...normal, activeSection: 'card-catalog' }))
  assert.match(blocked, /Solo un administrador/)
  assert.doesNotMatch(blocked, /<card-catalog-admin>/)
  assert.match(text(inicio.render.call({ ...normal, user: { role: 'admin' }, activeSection: 'card-catalog' })), /<card-catalog-admin>/)
})

test('optional image uses 40px square contain styling and is invisible until successfully loaded', () => {
  const styles = components.get('card-catalog-image').styles.cssText
  assert.match(styles, /:host \{ display: none;/)
  assert.match(styles, /:host\(\[loaded\]\)/)
  assert.match(styles, /width: 40px; height: 40px/)
  assert.match(styles, /object-fit: contain/)
  assert.match(styles, /border-radius: 8px/)
  assert.equal(image.render.call({ source: '' }), '')
  let visible = false
  const state = { source: '/api/card-images/1/version.webp', setAttribute: () => { visible = true }, removeAttribute: () => { visible = false } }
  const template = image.render.call(state)
  const callbacks = template.values.filter((value) => typeof value === 'function')
  callbacks[0]()
  assert.equal(visible, true)
  callbacks[1]()
  assert.equal(visible, false)
  assert.match(text(template), /alt=""/)
})

test('resolver requests are shared, unmatched names preserve layout, and lookup failures are retryable', async (t) => {
  invalidateCardImages()
  let calls = 0
  let fail = false
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (fail) return new Response(JSON.stringify({ error: 'Imagen temporalmente no disponible' }), { status: 503 })
    return new Response(JSON.stringify({ imageUrl: null }))
  })
  const state = () => ({ name: 'Sin imagen', type: 'Débito', removeAttribute: () => {} })
  const first = state()
  await Promise.all([image.resolve.call(first), image.resolve.call(state())])
  assert.equal(calls, 1)
  assert.equal(first.source, '')
  assert.equal(first.loaded, false)
  invalidateCardImages()
  await image.resolve.call(first)
  assert.equal(calls, 2)
  fail = true
  invalidateCardImages()
  await image.resolve.call(first)
  assert.equal(first.source, '')
  fail = false
  await image.resolve.call(first)
  assert.equal(calls, 4)
})

test('stale image responses cannot replace a newly selected card', async (t) => {
  invalidateCardImages()
  let release
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('Primera')) return new Promise((resolve) => { release = resolve })
    return new Response(JSON.stringify({ imageUrl: '/segunda.webp' }))
  })
  const state = { name: 'Primera', type: 'Débito', removeAttribute: () => {} }
  const first = image.resolve.call(state)
  state.name = 'Segunda'
  await image.resolve.call(state)
  release(new Response(JSON.stringify({ imageUrl: '/primera.webp' })))
  await first
  assert.equal(state.source, '/segunda.webp')
})

test('family cards resolve original account names, not holder-tagged names, before amounts', () => {
  const methods = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(finance))
    .filter(([, descriptor]) => typeof descriptor.value === 'function').map(([name, descriptor]) => [name, descriptor.value]))
  const state = { ...methods, today: new Date(2026, 6, 1), familyView: true, dashboard: { accounts: [] } }
  const markup = text(finance.renderBankCard.call(state, {
    id: 8, name: 'BBVA · Familiar', catalogName: 'BBVA', type: 'Débito', available: 100,
  }))
  assert.match(markup, /<h3>BBVA · Familiar<\/h3>/)
  assert.match(markup, /<card-catalog-image .name=BBVA .type=Débito>/)
  assert.ok(markup.indexOf('card-catalog-image') < markup.indexOf('Saldo disponible'))
})

test('admin screen checks current session before fetching the shared registry', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url)
    return new Response(JSON.stringify({ user: { role: 'usuario' } }))
  })
  const state = { loadFiles: () => assert.fail('Forbidden user must not browse files') }
  await admin.load.call(state)
  assert.equal(state.allowed, false)
  assert.match(state.error, /Solo un administrador/)
  assert.deepEqual(calls, ['/api/auth/me'])
})

test('editing and alias confirmation require a fresh preview and explicit save', () => {
  const methods = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(admin))
    .filter(([, descriptor]) => typeof descriptor.value === 'function').map(([name, descriptor]) => [name, descriptor.value]))
  const state = { ...methods, draft: { keyword: 'Bbbv' }, preview: { matches: [] }, previewImage: '' }
  state.asAlias({ id: 2, keyword: 'BBVA', scope: 'banco', aliases: [], imageUrl: '/bank.webp' })
  assert.equal(state.draft.id, 2)
  assert.deepEqual(state.draft.aliases, ['Bbbv'])
  assert.equal(state.preview, null)
  assert.match(state.notice, /guarda para confirmarlo/)
  state.preview = { matches: [] }
  state.change({ keyword: 'BBVA nuevo' })
  assert.equal(state.preview, null)
})

test('save without preview is blocked and preserves the draft', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Must preview before saving'))
  const state = { draft: { keyword: 'BBVA' }, preview: null }
  await admin.save.call(state, { preventDefault: () => {} })
  assert.match(state.error, /Revisa las coincidencias/)
  assert.equal(state.draft.keyword, 'BBVA')
})
