import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { netProxy } from './net-proxy'

const root = mkdtempSync(join(tmpdir(), 'notch-net-'))
const plugin = (id: string, permissions: string[], hosts?: string[]) => {
  mkdirSync(join(root, id))
  writeFileSync(join(root, id, 'manifest.json'), JSON.stringify({ id, name: id, version: '0.1.0', entry: 'dist/index.js', permissions, hosts, engines: { notch: '^1.0.0' } }))
}
plugin('github', ['net'], ['api.github.com'])
plugin('quiet', [], ['api.github.com'])

const upstream = vi.fn(async (input: string | URL | Request) => Response.json({ from: String(input) }))
let server: Server
let port = 0

beforeAll(async () => {
  vi.stubGlobal('fetch', upstream)
  const proxy = netProxy([root])
  server = createServer((req, res) => proxy(req, res, () => ((res.statusCode = 404), res.end())))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(() => {
  server.close()
  rmSync(root, { recursive: true })
})

function post(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: { error?: string; status?: number; body?: string } }> {
  return new Promise((resolve, reject) => {
    const req = request({ port, host: '127.0.0.1', method: 'POST', path: '/', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }))
    })
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}

describe('/__notch/net', () => {
  test('forwards to a manifest host', async () => {
    const result = await post({ plugin: 'github', request: { url: 'https://api.github.com/user' } })
    expect(result.status).toBe(200)
    expect(JSON.parse(result.body.body!)).toEqual({ from: 'https://api.github.com/user' })
  })

  test('forwards to an exact granted host, never a wildcard grant', async () => {
    expect((await post({ plugin: 'github', grants: ['youtrack.acme.com'], request: { url: 'https://youtrack.acme.com/api' } })).status).toBe(200)
    expect((await post({ plugin: 'github', grants: ['*.acme.com'], request: { url: 'https://x.acme.com/api' } })).status).toBe(502)
  })

  test('is not an open proxy', async () => {
    const calls = upstream.mock.calls.length
    expect(await post({ plugin: 'github', request: { url: 'https://evil.test/' } })).toMatchObject({ status: 502, body: { error: expect.stringContaining('not in the plugin') } })
    expect((await post({ plugin: 'nobody', request: { url: 'https://api.github.com/' } })).status).toBe(404)
    expect((await post({ plugin: 'quiet', request: { url: 'https://api.github.com/' } })).status).toBe(403)
    expect((await post({ plugin: 'github', request: { url: 'https://api.github.com/' } }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await post({ plugin: 'github', request: { url: 'https://api.github.com/' } }, { origin: 'https://evil.test' })).status).toBe(403)
    expect(upstream.mock.calls.length).toBe(calls)
  })
})
