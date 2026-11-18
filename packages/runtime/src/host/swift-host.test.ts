import { describe, expect, test, vi } from 'vitest'

const stored = new Map<string, unknown>()
const call = vi.fn(async (_plugin: string, method: string, params: { key: string; value?: unknown }) => {
  if (method === 'storage.get') return stored.get(params.key) ?? null
  if (method === 'storage.set') stored.set(params.key, params.value)
  if (method === 'shortcuts.register') return { id: 's1' }
  if (method === 'clipboard.readText') return { text: 'copied' }
  if (method === 'deepLinks.initial') return { url: null }
  if (method === 'updater.check') return { kind: 'available', version: '1.1.0' }
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
    await host.os.openPath('/tmp/a', 'Xcode')
    expect(call).toHaveBeenLastCalledWith('runtime', 'files.open', { path: '/tmp/a', app: 'Xcode' })
    await host.os.openPath('/tmp/a')
    expect(call).toHaveBeenLastCalledWith('runtime', 'files.open', { path: '/tmp/a' })
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

  test('clipboard and notifications go through the bridge', async () => {
    await host.clipboard.writeText('hello')
    expect(call).toHaveBeenLastCalledWith('runtime', 'clipboard.writeText', { text: 'hello' })
    expect(await host.clipboard.readText()).toBe('copied')
    await host.notifications.send({ title: 'hi', body: 'there' })
    expect(call).toHaveBeenLastCalledWith('runtime', 'notifications.send', { title: 'hi', body: 'there' })
  })

  test('a shortcut fires on its own id until it is unregistered', async () => {
    let pressed = 0
    const off = await host.shortcuts.register('CommandOrControl+Shift+K', () => pressed++)
    expect(call).toHaveBeenLastCalledWith('runtime', 'shortcuts.register', { accelerator: 'CommandOrControl+Shift+K' })
    dispatch([{ type: 'shortcut', payload: { id: 'other' } }, { type: 'shortcut', payload: { id: 's1' } }])
    off()
    expect(call).toHaveBeenLastCalledWith('runtime', 'shortcuts.unregister', { id: 's1' })
    dispatch([{ type: 'shortcut', payload: { id: 's1' } }])
    expect(pressed).toBe(1)
  })

  test('deep links: no launch URL reads undefined, opened ones reach listeners', async () => {
    expect(await host.deepLinks.initialUrl()).toBeUndefined()
    const seen: string[] = []
    const off = host.deepLinks.onOpen((url) => seen.push(url))
    dispatch([{ type: 'deepLink.open', payload: { url: 'justnotch://settings' } }])
    off()
    expect(seen).toEqual(['justnotch://settings'])
  })

  test('the updater asks Sparkle and follows an install until it settles', async () => {
    expect(await host.updater.check()).toEqual({ kind: 'available', version: '1.1.0' })
    expect(call).toHaveBeenLastCalledWith('runtime', 'updater.check', {})
    const seen: unknown[] = []
    await host.updater.install((state) => seen.push(state))
    expect(call).toHaveBeenLastCalledWith('runtime', 'updater.install', {})
    dispatch([
      { type: 'updater.state', payload: { kind: 'downloading', progress: 0 } },
      { type: 'updater.state', payload: { kind: 'ready', version: '1.1.0' } },
      { type: 'updater.state', payload: { kind: 'idle' } },
    ])
    expect(seen).toEqual([
      { kind: 'downloading', progress: 0 },
      { kind: 'ready', version: '1.1.0' },
    ])
  })

  test('what a notch panel lacks does nothing', async () => {
    await host.window.minimize()
  })
})
