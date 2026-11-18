import { API_VERSION, type HostEvent, type HostRequest, type InstalledPlugin, type LibraryCatalog, type PluginManifest } from '@just-notch/bridge-schema'
import { beforeAll, describe, expect, test, vi } from 'vitest'

const manifest: PluginManifest = {
  id: 'youtrack',
  name: 'YouTrack',
  version: '0.1.0',
  entry: 'dist/index.js',
  permissions: ['net', 'secrets'],
  hosts: ['*.youtrack.cloud'],
  engines: { notch: '^1.0.0' },
}

const store = new Map<string, string>()
const events: HostEvent[] = []
const confirm = vi.fn(() => true)
const proxied: unknown[] = []
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
})
vi.stubGlobal('location', new URL('http://localhost:5174/'))
vi.stubGlobal('window', { confirm, __notch: { dispatch: (e: HostEvent[]) => events.push(...e) } })
vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/plugins/index.json') return Response.json([{ manifest, builtIn: false }])
    if (url === '/__notch/net') {
      proxied.push(JSON.parse(String(init?.body)))
      return Response.json({ status: 200, url: 'https://acme.youtrack.cloud/api', headers: {}, body: '[]', encoding: 'text' })
    }
    return new Response(null, { status: 404 })
  }),
)

const { installMockHost, libraryTiming, mock } = await import('./mock')
installMockHost()
libraryTiming.step = 0
const host = (plugin: string, method: HostRequest['method'], params: unknown) =>
  window.webkit!.messageHandlers.host.postMessage({ plugin, method, params } as HostRequest)
const tick = () => new Promise((resolve) => setTimeout(resolve))

beforeAll(async () => {
  await host('runtime', 'host.ready', {})
})

test('index.json tags library plugins as not built in', async () => {
  const info = (await host('runtime', 'host.ready', {})) as { plugins: InstalledPlugin[]; apiVersion: string }
  expect(info.plugins.map((p) => [p.builtIn, p.source])).toEqual([[false, 'library']])
  expect(info.apiVersion).toBe(API_VERSION)
})

describe('mock secrets', () => {
  test('per plugin in localStorage; changes carry no value', async () => {
    expect(await host('youtrack', 'secrets.get', { key: 'token' })).toEqual({ value: null })
    await host('youtrack', 'secrets.set', { key: 'token', value: 'perm:1' })
    expect(await host('youtrack', 'secrets.get', { key: 'token' })).toEqual({ value: 'perm:1' })
    expect(store.get('notch:mock:secret:youtrack:token')).toBe('perm:1')
    await tick()
    expect(events.at(-1)).toEqual({ type: 'secrets.changed', payload: { plugin: 'youtrack', key: 'token' } })
    await host('youtrack', 'secrets.delete', { key: 'token' })
    expect(await host('youtrack', 'secrets.get', { key: 'token' })).toEqual({ value: null })
  })

  test('bad keys and the runtime are refused', async () => {
    await expect(host('youtrack', 'secrets.set', { key: 'a b', value: 'x' })).rejects.toContain('secret keys')
    await expect(host('runtime', 'secrets.get', { key: 'token' })).rejects.toContain('for plugins only')
    await expect(host('runtime', 'net.fetch', { url: 'https://acme.youtrack.cloud/' })).rejects.toContain('for plugins only')
  })
})

describe('mock net', () => {
  test('requestHost: manifest hosts need no prompt; a grant persists; a denial sticks for the session', async () => {
    expect(await host('youtrack', 'net.requestHost', { url: 'https://acme.youtrack.cloud/' })).toEqual({ granted: true })
    expect(confirm).not.toHaveBeenCalled()

    expect(await host('youtrack', 'net.requestHost', { url: 'https://youtrack.acme.com/x', reason: 'Your server' })).toEqual({ granted: true })
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('“YouTrack” wants to connect to youtrack.acme.com'))
    expect(await host('youtrack', 'net.hosts', {})).toEqual({ manifest: ['*.youtrack.cloud'], granted: ['youtrack.acme.com'] })

    confirm.mockReturnValueOnce(false)
    expect(await host('youtrack', 'net.requestHost', { url: 'https://other.test/' })).toEqual({ granted: false })
    expect(await host('youtrack', 'net.requestHost', { url: 'https://other.test/' })).toEqual({ granted: false })
    expect(confirm).toHaveBeenCalledTimes(2)

    await host('runtime', 'net.revokeHost', { plugin: 'youtrack', host: 'youtrack.acme.com' })
    expect(await host('youtrack', 'net.hosts', {})).toEqual({ manifest: ['*.youtrack.cloud'], granted: [] })
    await expect(host('youtrack', 'net.revokeHost', { plugin: 'youtrack', host: 'x' })).rejects.toContain('runtime only')
  })

  test('fetch goes through the dev proxy with the grants', async () => {
    const result = await host('youtrack', 'net.fetch', { url: 'https://acme.youtrack.cloud/api' })
    expect(result).toMatchObject({ status: 200, body: '[]' })
    expect(proxied.at(-1)).toEqual({ plugin: 'youtrack', grants: [], request: { url: 'https://acme.youtrack.cloud/api' } })
  })
})

describe('mock library', () => {
  const plugins = () => events.flatMap((e) => (e.type === 'plugins.changed' ? [e.payload.plugins] : [])).at(-1)
  const phases = (id: string) => events.flatMap((e) => (e.type === 'library.progress' && e.payload.id === id ? [e.payload.phase] : []))

  test('the catalog lists the served library plugins and one for a newer API', async () => {
    const catalog = (await host('runtime', 'library.catalog', {})) as LibraryCatalog
    expect(catalog.plugins.map((p) => [p.id, p.version, p.engines.notch])).toEqual([
      ['youtrack', '0.1.0', '^1.0.0'],
      ['linear', '2.0.0', '^2.0.0'],
    ])
    expect(catalog.plugins[0].download.url).toMatch(/^https:\/\/github\.com\/justAnArthur\/just-notch\/releases\/download\//)
    await expect(host('runtime', 'library.install', { id: 'linear' })).rejects.toContain('Needs plugin API ^2.0.0')
    await expect(host('youtrack', 'library.catalog', {})).rejects.toContain('runtime only')
  })

  test('uninstall, install with progress, then an update', async () => {
    await host('runtime', 'library.uninstall', { id: 'youtrack' })
    await tick()
    expect(plugins()).toEqual([])

    const installed = (await host('runtime', 'library.install', { id: 'youtrack' })) as InstalledPlugin
    await tick()
    expect(installed).toMatchObject({ source: 'library', enabled: true, manifest: { version: '0.1.0' } })
    expect(plugins()?.map((p) => p.manifest.id)).toEqual(['youtrack'])
    expect([...new Set(phases('youtrack'))]).toEqual(['downloading', 'verifying', 'installing', 'done'])

    mock.libraryUpdate('youtrack')
    const updated = (await host('runtime', 'library.install', { id: 'youtrack' })) as InstalledPlugin
    expect(updated.manifest.version).toBe('0.1.1')
    expect(store.get('notch:mock:library')).toBe(JSON.stringify({ youtrack: '0.1.1' }))
  })

  test('a declined install says cancelled', async () => {
    confirm.mockReturnValueOnce(false)
    await expect(host('runtime', 'library.install', { id: 'youtrack' })).rejects.toBe('cancelled')
    await tick()
    expect(events.at(-1)).toEqual({ type: 'library.progress', payload: { id: 'youtrack', phase: 'error', message: 'cancelled' } })
  })
})
