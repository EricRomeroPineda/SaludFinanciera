import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { serveStatic } from './static.js'
import { server } from './index.js'
import { pool } from './db.js'

test('static serving returns correct GET/HEAD types and restricts reads to dist', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'salud-static-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'dist')
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Salud</title>')
  await writeFile(join(root, 'assets', 'app.js'), 'export const value = 1')
  await writeFile(join(root, 'assets', 'app.css'), 'body { color: green }')
  await writeFile(join(directory, 'private.txt'), 'not public')
  for (const [pathname, mime] of [
    ['/', 'text/html'], ['/assets/app.js', 'text/javascript'], ['/assets/app.css', 'text/css'],
  ]) {
    let length
    for (const method of ['GET', 'HEAD']) {
      const response = {
        writeHead(status, headers) { this.status = status; this.headers = headers },
        end(body) { this.body = body },
      }
      assert.equal(await serveStatic({ method }, response, pathname, root), true)
      assert.equal(response.status, 200)
      assert.ok(response.headers['Content-Type'].startsWith(mime))
      assert.equal(response.headers['X-Content-Type-Options'], 'nosniff')
      if (method === 'GET') {
        length = response.body.length
        assert.ok(length > 0)
      } else {
        assert.equal(response.body, null)
        assert.equal(response.headers['Content-Length'], length)
      }
    }
  }
  const response = { writeHead() { assert.fail('Must not serve') } }
  for (const pathname of [
    '/missing.js', '/assets', '/../private.txt', '/%2e%2e/private.txt',
    '/%2e%2e%5cprivate.txt', '/C:/private.txt', '/index.html:secret', '/%00',
  ]) assert.equal(await serveStatic({ method: 'GET' }, response, pathname, root), false, pathname)
  assert.equal(await serveStatic({ method: 'POST' }, response, '/', root), false)
  await assert.rejects(serveStatic({ method: 'GET' }, response, '/%invalid', root), { statusCode: 400 })
  // Directory junctions work without elevated symlink privileges on Windows.
  await symlink(directory, join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(await serveStatic({ method: 'GET' }, response, '/outside/private.txt', root), false)
})

test('existing HTTP server serves the build and leaves API routes as JSON, including health checks', async (t) => {
  let healthQueried = false
  t.mock.method(pool, 'getConnection', async () => ({
    async query(sql) { assert.equal(sql, 'SELECT 1'); healthQueried = true },
    release() {},
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const base = `http://127.0.0.1:${server.address().port}`
  const index = await fetch(`${base}/`)
  assert.equal(index.status, 200, 'Run npm run build before this integration test')
  assert.match(index.headers.get('content-type'), /text\/html/)
  const html = await index.text()
  assert.match(html, /<!doctype html>/i)
  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1])
  assert.ok(assets.some((asset) => asset.endsWith('.js')))
  assert.ok(assets.some((asset) => asset.endsWith('.css')))
  for (const asset of ['/', ...assets]) {
    const get = await fetch(`${base}${asset}`)
    const body = await get.arrayBuffer()
    assert.equal(get.status, 200)
    if (asset.endsWith('.js')) assert.match(get.headers.get('content-type'), /text\/javascript/)
    if (asset.endsWith('.css')) assert.match(get.headers.get('content-type'), /text\/css/)
    const head = await fetch(`${base}${asset}`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(Number(head.headers.get('content-length')), body.byteLength)
    assert.equal(await head.text(), '')
  }
  const unknown = await fetch(`${base}/api/missing`)
  assert.equal(unknown.status, 404)
  assert.match(unknown.headers.get('content-type'), /application\/json/)
  assert.deepEqual(await unknown.json(), { error: 'Ruta no encontrada.' })
  assert.equal((await fetch(`${base}/missing.js`)).status, 404)
  assert.equal((await fetch(`${base}/src/api.js`)).status, 404)
  const health = await fetch(`${base}/api/health/db`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { ok: true, database: 'connected' })
  assert.equal(healthQueried, true)
})
