import type { InstalledPlugin } from '@just-notch/bridge-schema'
import { describe, expect, test, vi } from 'vitest'

const secrets = new Map<string, string>()
const call = vi.fn(async (_plugin: string, method: string, params: Record<string, unknown>) => {
  if (method === 'net.fetch') return { status: 200, url: `${params.url}`, headers: { 'content-type': 'application/json' }, body: '{"ok":true}', encoding: 'text' }
  if (method === 'net.requestHost') return { granted: true }
  if (method === 'secrets.get') return { value: secrets.get(params.key as string) ?? null }
  if (method === 'secrets.set') secrets.set(params.key as string, params.value as string)
  if (method === 'secrets.delete') secrets.delete(params.key as string)
  return null
})
vi.mock('../host/client', () => ({ call, log: vi.fn() }))

const { createPluginContext } = await import('./context')
const { dispatch } = await import('../host/bus')

const plugin = (permissions: InstalledPlugin['manifest']['permissions']): InstalledPlugin => ({
  manifest: { id: 'github', name: 'GitHub', version: '0.1.0', entry: 'dist/index.js', permissions, hosts: ['api.github.com'], engines: { notch: '^1.0.0' } },
  baseUrl: 'notch://app/plugins/github/',
  enabled: true,
  builtIn: false,
  source: 'user',
})

describe('ctx.fetch', () => {
  test('sends a net.fetch as the plugin and resolves with a Response', async () => {
    const { ctx } = createPluginContext(plugin(['net']))
    const response = await ctx.fetch(new URL('https://api.github.com/user'), {
      method: 'POST',
      headers: new Headers({ Authorization: 'Bearer t' }),
      json: { a: 1 },
      timeoutMs: 5000,
    })
    expect(call).toHaveBeenLastCalledWith('github', 'net.fetch', {
      url: 'https://api.github.com/user',
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      json: { a: 1 },
      timeoutMs: 5000,
    })
    expect(response).toBeInstanceOf(Response)
    expect(response.url).toBe('https://api.github.com/user')
    expect(await response.json()).toEqual({ ok: true })
  })

  test('a plain GET sends only the url', async () => {
    await createPluginContext(plugin(['net'])).ctx.fetch('https://api.github.com/')
    expect(call).toHaveBeenLastCalledWith('github', 'net.fetch', { url: 'https://api.github.com/' })
  })

  test('needs the net permission', async () => {
    const { ctx } = createPluginContext(plugin([]))
    await expect(ctx.fetch('https://api.github.com/')).rejects.toThrow('needs the net permission')
    await expect(ctx.net.requestHost('https://x.test/')).rejects.toThrow('needs the net permission')
  })

  test('net.requestHost answers a boolean', async () => {
    const { ctx } = createPluginContext(plugin(['net']))
    expect(await ctx.net.requestHost('https://youtrack.acme.com/', 'Your YouTrack')).toBe(true)
    expect(call).toHaveBeenLastCalledWith('github', 'net.requestHost', { url: 'https://youtrack.acme.com/', reason: 'Your YouTrack' })
  })
})

describe('ctx.secrets', () => {
  test('get, set and set(null) to delete', async () => {
    const { ctx } = createPluginContext(plugin(['secrets']))
    expect(await ctx.secrets.get('token')).toBeNull()
    await ctx.secrets.set('token', 'ghp_1')
    expect(await ctx.secrets.get('token')).toBe('ghp_1')
    await ctx.secrets.set('token', null)
    expect(call).toHaveBeenLastCalledWith('github', 'secrets.delete', { key: 'token' })
    expect(await ctx.secrets.get('token')).toBeNull()
  })

  test('subscribe follows this plugin and key; release stops it', () => {
    const { ctx, release } = createPluginContext(plugin(['secrets']))
    const cb = vi.fn()
    ctx.secrets.subscribe('token', cb)
    dispatch([
      { type: 'secrets.changed', payload: { plugin: 'other', key: 'token' } },
      { type: 'secrets.changed', payload: { plugin: 'github', key: 'other' } },
      { type: 'secrets.changed', payload: { plugin: 'github', key: 'token' } },
    ])
    expect(cb).toHaveBeenCalledTimes(1)
    release()
    dispatch([{ type: 'secrets.changed', payload: { plugin: 'github', key: 'token' } }])
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test('needs the secrets permission', async () => {
    await expect(createPluginContext(plugin(['net'])).ctx.secrets.get('token')).rejects.toThrow('needs the secrets permission')
  })
})
