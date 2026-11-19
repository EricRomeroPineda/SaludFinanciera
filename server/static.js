import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url))
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

function isWithin(root, file) {
  const path = relative(root, file)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

export async function serveStatic(request, response, pathname, root = distDirectory) {
  if (!['GET', 'HEAD'].includes(request.method)) return false
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    throw Object.assign(new Error('La ruta no es válida.'), { statusCode: 400 })
  }
  // Reject Windows separators, drive/stream names and traversal on every OS.
  if (/[\0\\:]/.test(decoded) || decoded.split('/').includes('..')) return false
  const file = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`)
  if (!isWithin(root, file)) return false
  try {
    const realRoot = await realpath(root)
    const realFile = await realpath(file)
    if (!isWithin(realRoot, realFile)) return false
    const info = await stat(realFile)
    if (!info.isFile()) return false
    const body = request.method === 'HEAD' ? null : await readFile(realFile)
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(realFile).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body ? body.length : info.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...(extname(realFile).toLowerCase() === '.html'
        ? { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' } : {}),
    })
    response.end(body)
    return true
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false
    throw error
  }
}
