import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css?inline')) return { format: 'module', source: 'export default ""', shortCircuit: true }
    return next(url, context)
  },
})
let Component
globalThis.customElements = { define: (_, component) => { Component = component } }
await import('../../src/inicio/email-settings.js')

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.strings) return value.strings.reduce((output, part, index) => output + part + text(value.values[index]), '')
  return value == null || typeof value === 'function' ? '' : String(value)
}

test('profile separates the username autofill target from the actual registered email', () => {
  const methods = Component.prototype
  for (const email of [null, '', 'ana@example.com']) {
    const markup = text(methods.render.call({ user: { name: 'Ana', email, emailVerified: 0 }, eye: methods.eye }))
    assert.match(markup, /name="username"[\s\S]*?\.value=Ana hidden readonly/)
    assert.match(markup, /autocomplete="section-profile-email email"/)
    assert.ok(markup.includes(`.value=${email || ''} required`))
    assert.match(markup, /autocomplete="section-profile-email current-password"/)
    assert.match(markup, /\?disabled=true[\s\S]*?Enviar enlace para cambiar mi palabra clave/)
    if (!email) assert.match(markup, /Captura tu correo y verifícalo/)
  }
})

test('recovery requires both a saved email and verification, not just a verification flag', () => {
  const methods = Component.prototype
  for (const [email, emailVerified, disabled] of [[null, 1, true], ['ana@example.com', 0, true], ['ana@example.com', 1, false]]) {
    const markup = text(methods.render.call({ user: { name: 'Ana', email, emailVerified }, eye: methods.eye, busy: false }))
    assert.ok(markup.includes(`?disabled=${disabled}\n          @click=`))
  }
})
