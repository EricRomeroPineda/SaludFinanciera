import assert from 'node:assert/strict'
import { test } from 'node:test'

let Component
globalThis.customElements = { define: (_, component) => { Component = component } }
await import('../../src/inicio/photo-editor.js')
const methods = Component.prototype

test('circular crop covers the output at every rotation, zoom and position limit', () => {
  for (const [width, height] of [[1000, 500], [500, 1000], [600, 600]]) {
    for (const angle of [0, 90, 180, 270]) {
      for (const zoom of [1, 4]) {
        for (const position of [-100, 100]) {
          let translation
          let scaling
          let rotation
          const context = {
            clearRect() {}, save() {}, restore() {},
            translate(...args) { translation = args },
            rotate(value) { rotation = value },
            scale(...args) { scaling = args },
            drawImage(image, x, y) {
              assert.equal(x, -image.naturalWidth / 2)
              assert.equal(y, -image.naturalHeight / 2)
            },
          }
          methods.draw.call({
            renderRoot: { querySelector: () => ({ width: 600, height: 600, getContext: () => context }) },
            image: { naturalWidth: width, naturalHeight: height },
            angle, zoom, positionX: position, positionY: position, flipX: true, flipY: false,
          })
          assert.ok(scaling[0] < 0 && scaling[1] > 0)
          assert.equal(rotation, angle * Math.PI / 180)
          const outputWidth = (angle % 180 ? height : width) * Math.abs(scaling[0])
          const outputHeight = (angle % 180 ? width : height) * scaling[1]
          assert.ok(translation[0] - outputWidth / 2 <= 0)
          assert.ok(translation[0] + outputWidth / 2 >= 600)
          assert.ok(translation[1] - outputHeight / 2 <= 0)
          assert.ok(translation[1] + outputHeight / 2 >= 600)
        }
      }
    }
  }
})

test('reset restores all transforms without replacing the selected image', () => {
  const image = {}
  const state = { image, zoom: 4, angle: 90, flipX: true, flipY: true, positionX: 100, positionY: -100 }
  methods.reset.call(state)
  assert.deepEqual(state, { image, zoom: 1, angle: 0, flipX: false, flipY: false, positionX: 0, positionY: 0 })
})

test('selection rejects unsupported files and files over five megabytes without discarding the draft', async () => {
  for (const file of [{ type: 'text/html', size: 10 }, { type: 'image/png', size: 5 * 1024 * 1024 + 1 }]) {
    const state = { source: 'existing-draft', load: () => assert.fail('Must reject before decoding') }
    const target = { files: [file], value: 'file' }
    await methods.select.call(state, { target })
    assert.match(state.error, /hasta 5 MB/)
    assert.equal(state.source, 'existing-draft')
    assert.equal(target.value, '')
  }
})

test('failed decoding reports an error instead of applying an unreadable image', async (t) => {
  const previous = globalThis.Image
  t.after(() => {
    if (previous === undefined) delete globalThis.Image
    else globalThis.Image = previous
  })
  globalThis.Image = function () {
    this.decode = async () => { throw new Error('Decode failed') }
  }
  const state = {}
  await methods.load.call(state, 'bad-image')
  assert.match(state.error, /No se pudo abrir la imagen/)
  assert.equal(state.image, undefined)
  assert.equal(state.busy, false)
})
