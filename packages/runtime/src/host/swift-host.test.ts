import { describe, expect, test, vi } from 'vitest'

const stored = new Map<string, unknown>()
const call = vi.fn(async (_plugin: string, method: string, params: { key: string; value?: unknown }) => {
  if (method === 'storage.get') return stored.get(params.key) ?? null
  if (method === 'storage.set') stored.set(params.key, params.value)
  return null
})
vi.mock('./client', () => ({ call, log: vi.fn() }))

const { createSwiftHost } = await import('./swift-host')
const { dispatch } = await import('./bus')
const host = createSwiftHost({ name: 'just-notch', version: '1.0.0' })

describe('swift host', () => {
  test('is the platform host for the notch: dark, macOS', async () => {
    expect(host.kind).toBe('swift')
    expect(await host.os.colorScheme()).toBe('dark')
  })

  test('maps os calls onto bridge methods as the runtime', async () => {
    await host.os.openExternal('https://example.com')
    expect(call).toHaveBeenLastCalledWith('runtime', 'system.openUrl', { url: 'https://example.com' })
    await expect(host.os.openPath('/tmp/a', 'Xcode')).rejects.toThrow()
  })

  test('the store is the runtime storage: unset and deleted read as undefined', async () => {
    expect(await host.store.get('k')).toBeUndefined()
    await host.store.set('k', { a: 1 })
    expect(await host.store.get('k')).toEqual({ a: 1 })
    await host.store.delete('k')
    expect(await host.store.get('k')).toBeUndefined()
  })

  test('store changes follow only the runtime key', () => {
    const seen: unknown[] = []
    host.store.onChange('k', (value) => seen.push(value))
    dispatch([
      { type: 'storage.changed', payload: { plugin: 'clock', key: 'k', value: 1 } },
      { type: 'storage.changed', payload: { plugin: 'runtime', key: 'other', value: 2 } },
      { type: 'storage.changed', payload: { plugin: 'runtime', key: 'k', value: 3 } },
      { type: 'storage.changed', payload: { plugin: 'runtime', key: 'k', value: null } },
    ])
    expect(seen).toEqual([3, undefined])
  })

  test('invoke and on pass through to the bridge', async () => {
    await host.invoke('window.openSettings')
    expect(call).toHaveBeenLastCalledWith('runtime', 'window.openSettings', {})
    const seen: unknown[] = []
    const off = host.on('settings.open', (payload) => seen.push(payload))
    dispatch([{ type: 'settings.open', payload: {} }])
    off()
    dispatch([{ type: 'settings.open', payload: {} }])
    expect(seen).toEqual([{}])
  })

  test('what a notch panel lacks rejects or does nothing', async () => {
    await expect(host.notifications.send({ title: 'hi' })).rejects.toThrow()
    await expect(host.shortcuts.register('Cmd+K', () => {})).rejects.toThrow()
    expect(await host.updater.check()).toEqual({ kind: 'idle' })
    expect(await host.deepLinks.initialUrl()).toBeUndefined()
    await host.window.minimize()
  })
})
