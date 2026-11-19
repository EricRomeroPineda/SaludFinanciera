import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css?inline')) return { format: 'module', source: 'export default ""', shortCircuit: true }
    return next(url, context)
  },
})
const components = new Map()
globalThis.customElements = { define: (name, component) => components.set(name, component) }
await import('./salud-financiera.js')
const evidence = components.get('movement-evidence').prototype
const finance = components.get('salud-financiera').prototype
const calendar = components.get('financial-calendar').prototype
const related = components.get('finance-related-movements').prototype
const methods = (prototype) => Object.fromEntries(Object.getOwnPropertyNames(prototype)
  .filter((name) => typeof prototype[name] === 'function').map((name) => [name, prototype[name]]))

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  if (value?.values) return text(value.values)
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('evidence input is optional and available in movement forms, the general register and related histories', () => {
  const form = text(finance.renderMovementForm.call({
    dashboard: { accounts: [], categories: [], plans: [], subscriptions: [] },
    movementOperation: 'expense',
  }))
  assert.match(form, /<movement-evidence id="movement-evidence"/)
  const panel = text(evidence.render.call({ ...methods(evidence), expanded: true, pending: [], images: [] }))
  assert.match(panel, /type="file" accept="image\/jpeg,image\/png,image\/webp" multiple/)
  assert.doesNotMatch(panel, /required/)
  const item = { id: 8, date: '2026-11-19', amount: '10' }
  const register = text(calendar.renderMonthlyTable.call({
    data: { movements: [item] }, scope: 'all', formatMoney: () => '$10',
  }, 'Noviembre'))
  assert.match(register, /<th>Evidencia<\/th>/)
  assert.match(register, /<movement-evidence .movementId=8/)
  const history = text(related.render.call({ items: [item] }))
  assert.match(history, /<th>Evidencia<\/th>/)
  assert.match(history, /<movement-evidence .movementId=8/)
})

test('selection validates total count and file sizes and leaves previous pending evidence intact on error', () => {
  const state = { images: [], pending: [] }
  const file = new File(['image'], 'recibo.png', { type: 'image/png' })
  const event = (files) => ({ currentTarget: { files, value: 'files' } })
  evidence.selectFiles.call(state, event([file]))
  assert.equal(state.pending.length, 1)
  evidence.selectFiles.call(state, event([new File(['bad'], 'script.svg', { type: 'image/svg+xml' })]))
  assert.match(state.error, /JPG, PNG o WebP/)
  assert.equal(state.pending.length, 1)
  evidence.selectFiles.call(state, event([new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })]))
  assert.match(state.error, /5 MB/)
  evidence.selectFiles.call(state, event(Array(5).fill(file)))
  assert.match(state.error, /hasta 5 imágenes/)
  assert.equal(state.pending.length, 1)
})

test('uploads use raw binary with the correct MIME and remove only successfully uploaded files from the pending queue', async (t) => {
  const first = new File(['one'], 'uno.png', { type: 'image/png' })
  const second = new File(['two'], 'dos.png', { type: 'image/png' })
  let fail = true
  const uploaded = []
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, '/api/movements/8/evidence')
    assert.equal(options.headers['Content-Type'], 'image/png')
    assert.equal(options.credentials, 'same-origin')
    uploaded.push(options.body.name)
    if (options.body === second && fail) return new Response(JSON.stringify({ error: 'Sin espacio' }), { status: 500 })
    return new Response(JSON.stringify({ image: { id: options.body === first ? 1 : 2, name: options.body.name } }))
  })
  const state = { ...methods(evidence), pending: [first, second], images: [] }
  await assert.rejects(state.uploadPending(8), /Sin espacio/)
  assert.deepEqual(state.pending, [second])
  assert.equal(state.images.length, 1)
  assert.equal(state.busy, false)
  assert.equal(state.error, 'Sin espacio')
  fail = false
  await state.uploadPending(8)
  assert.deepEqual(uploaded, ['uno.png', 'dos.png', 'dos.png'])
  assert.equal(state.pending.length, 0)
  assert.equal(state.images.length, 2)
})

test('after saving a movement, failed evidence upload retains its form and retries with PUT rather than duplicate POST', async (t) => {
  const formData = new Map([['amount', '10'], ['date', '2026-11-19'], ['originAccountId', '2']])
  t.mock.method(globalThis, 'FormData', function () { return formData })
  const requests = []
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    requests.push({ path, method: options.method })
    return new Response(JSON.stringify({ ok: true, id: 18 }))
  })
  const pending = {
    pending: [new File(['image'], 'recibo.png', { type: 'image/png' })],
    uploadPending: async () => { throw new Error('Sin conexión') },
  }
  let refreshes = 0
  const originalDraft = { date: '2026-11-19' }
  const state = {
    ...methods(finance), movementOperation: 'expense', showMovementForm: true, newMovementDefaults: originalDraft,
    renderRoot: { querySelector: () => pending },
    refreshDashboard: async () => { refreshes++ },
  }
  await state.handleSaveMovement({ preventDefault() {}, currentTarget: {} })
  assert.equal(state.showMovementForm, true)
  assert.equal(state.pendingEvidenceMovementId, 18)
  assert.equal(state.editingMovement, undefined)
  assert.equal(state.newMovementDefaults, originalDraft, 'Keyed form must remain mounted with its pending files')
  assert.match(state.error, /#18 ya se guardó/)
  pending.uploadPending = async (id) => { assert.equal(id, 18); pending.pending = [] }
  await state.handleSaveMovement({ preventDefault() {}, currentTarget: {} })
  assert.deepEqual(requests, [{ path: '/api/movements', method: 'POST' }, { path: '/api/movements/18', method: 'PUT' }])
  assert.equal(state.showMovementForm, false)
  assert.equal(state.pendingEvidenceMovementId, null)
  assert.equal(refreshes, 1)
})

test('a failed financial movement never starts an evidence upload', async (t) => {
  t.mock.method(globalThis, 'FormData', function () { return new Map() })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Saldo insuficiente' }), { status: 409 }))
  const state = {
    movementOperation: 'expense', showMovementForm: true,
    renderRoot: { querySelector: () => ({ pending: [{}], uploadPending: () => assert.fail('Must not upload') }) },
  }
  await finance.handleSaveMovement.call(state, { preventDefault() {}, currentTarget: {} })
  assert.equal(state.error, 'Saldo insuficiente')
  assert.equal(state.showMovementForm, true)
  assert.equal(state.pendingEvidenceMovementId, undefined)
})

test('closing after a partial upload refreshes the already-saved movement and resets the retry ID', async () => {
  let refreshed = false
  const state = {
    showMovementForm: true, pendingEvidenceMovementId: 18,
    refreshDashboard: async () => { refreshed = true },
  }
  await finance.closeMovementDialog.call(state)
  assert.equal(state.showMovementForm, false)
  assert.equal(state.pendingEvidenceMovementId, null)
  assert.equal(refreshed, true)
  const markup = text(finance.renderMovementForm.call({
    pendingEvidenceMovementId: 18, movementOperation: 'expense',
    dashboard: { accounts: [], categories: [], plans: [], subscriptions: [] },
  }))
  assert.match(markup, /id="movement-evidence"[\s\S]*?\.movementId=18/)
})

test('family evidence hides mutation controls even for self-owned records and uses authenticated endpoints', async (t) => {
  const state = { ...methods(evidence), readOnly: true, canManage: true, expanded: true,
    movementId: 8, images: [{ id: 1, name: 'recibo.webp' }], pending: [] }
  const markup = text(state.render())
  assert.doesNotMatch(markup, /type="file"|Eliminar imagen|Subir imágenes/)
  assert.match(markup, /\/api\/movements\/8\/evidence\/1/)
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Sin permiso' }), { status: 404 }))
  state.requestVersion = 0
  await state.load()
  assert.equal(state.error, 'Sin permiso')
  assert.equal(state.loading, false)
})
