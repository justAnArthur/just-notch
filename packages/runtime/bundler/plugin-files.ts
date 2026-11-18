import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
}

type Next = () => void

export function sendFile(res: ServerResponse, file: string) {
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.end(readFileSync(file))
}

/** Serves `dir` raw (no Vite transform) under the prefix the middleware is mounted at. */
export function serveDir(dir: () => string) {
  return (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]))
    const file = join(dir(), path)
    if (!file.startsWith(dir() + sep) || !existsSync(file) || !statSync(file).isFile()) return next()
    sendFile(res, file)
  }
}

/** A folder of plugin folders; `builtIn: false` for `library/*`, which the app doesn't bundle. */
export interface PluginRoot {
  dir: string
  builtIn: boolean
}

export function pluginFolders(roots: PluginRoot[]) {
  const folders = new Map<string, { folder: string; builtIn: boolean }>()
  for (const { dir, builtIn } of roots) {
    if (!existsSync(dir)) continue
    for (const id of readdirSync(dir)) {
      const folder = join(dir, id)
      if (existsSync(join(folder, 'manifest.json'))) folders.set(id, { folder, builtIn })
    }
  }
  return folders
}

/**
 * Workspace plugins at `/plugins/<id>/…`, and `/plugins/index.json` listing
 * `{ manifest, builtIn }` for the mock host. Served raw, so their bare imports
 * stay for the import map.
 */
export function servePlugins(roots: PluginRoot[]) {
  return (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const path = (req.url ?? '/').split('?')[0]
    const folders = pluginFolders(roots)
    if (path === '/index.json') {
      const entries = [...folders.values()].map(({ folder, builtIn }) => ({ manifest: JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')), builtIn }))
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-cache')
      return res.end(JSON.stringify(entries))
    }
    const [, id] = path.split('/')
    const folder = folders.get(id)?.folder
    if (!folder) return next()
    return serveDir(() => folder)({ ...req, url: path.slice(id.length + 1) } as IncomingMessage, res, next)
  }
}
