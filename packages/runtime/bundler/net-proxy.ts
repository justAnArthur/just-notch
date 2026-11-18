import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { type NetRequest, type PluginManifest, validHostPattern } from '@just-notch/bridge-schema'
import { performNetFetch } from '../src/host/net.ts'
import { pluginFolders } from './plugin-files.ts'

const MAX_REQUEST_BYTES = 8 * 1024 * 1024
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

interface ProxyRequest {
  plugin: string
  /** The mock host's grants (localStorage): exact hosts only. */
  grants?: unknown
  request: NetRequest
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_REQUEST_BYTES) req.destroy(new Error('request too large'))
      else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * `/__notch/net`: the mock host's `net.fetch` in the dev server, so plugins reach APIs without CORS.
 * Never an open proxy: loopback callers from the dev page only, and only to hosts in the calling
 * plugin's manifest or granted to it.
 */
export function netProxy(roots: string[]) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'POST') return next()
    const send = (status: number, body: unknown) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(body))
    }
    if (!LOOPBACK.includes(req.socket.remoteAddress ?? '')) return send(403, { error: 'the dev proxy answers this machine only' })
    const site = req.headers['sec-fetch-site']
    const origin = req.headers.origin
    if ((site && site !== 'same-origin') || (origin && URL.canParse(origin) && new URL(origin).host !== req.headers.host))
      return send(403, { error: 'the dev proxy answers the dev page only' })
    if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'send JSON' })

    let body: ProxyRequest
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return send(400, { error: 'invalid JSON' })
    }
    const folder = typeof body.plugin === 'string' ? pluginFolders(roots).get(body.plugin) : undefined
    if (!folder) return send(404, { error: `unknown plugin ${body.plugin}` })
    const manifest: PluginManifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))
    if (!manifest.permissions.includes('net')) return send(403, { error: `${manifest.id} needs the net permission for net.fetch` })

    const grants = Array.isArray(body.grants) ? body.grants.filter((g): g is string => typeof g === 'string' && !g.includes('*') && validHostPattern(g)) : []
    try {
      send(200, await performNetFetch(body.request, [...(manifest.hosts ?? []), ...grants], { manualRedirects: true }))
    } catch (error) {
      send(502, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
