import type { Host, Unsubscribe } from '@just-apps/host-contract'
import type { EventName, Method } from '@just-notch/bridge-schema'
import { on } from './bus'
import { call } from './client'

const noop: Unsubscribe = () => {}
const unsupported = (what: string) => Promise.reject(new Error(`${what}: not supported by the notch host yet`))

/**
 * The platform's `Host` over the notch bridge, as the runtime (`plugin: 'runtime'`).
 * In a browser the mock host answers the same bridge, so this works there too.
 */
export function createSwiftHost(app: Host['app']): Host {
  return {
    kind: 'swift',
    app,

    os: {
      platform: 'macos',
      // The island is always on true black.
      colorScheme: async () => 'dark',
      onColorSchemeChange: () => noop,
      openExternal: async (url) => {
        await call('runtime', 'system.openUrl', { url })
      },
      revealPath: async (path) => {
        await call('runtime', 'files.reveal', { path })
      },
      openPath: async (path, opener) => {
        if (opener) return unsupported('openPath with an app')
        await call('runtime', 'files.open', { path })
      },
    },

    // The bridge copies only its own clips: arbitrary text goes through the web view's pasteboard.
    clipboard: {
      writeText: (text) => navigator.clipboard.writeText(text),
      readText: () => navigator.clipboard.readText(),
    },

    // One borderless panel, always on screen: nothing to title, minimize or close; its one other page is settings.
    window: {
      label: 'main',
      setTitle: async () => {},
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      open: async () => {
        await call('runtime', 'window.openSettings', {})
      },
      onFocusChange(listener) {
        const focus = () => listener(true)
        const blur = () => listener(false)
        window.addEventListener('focus', focus)
        window.addEventListener('blur', blur)
        return () => {
          window.removeEventListener('focus', focus)
          window.removeEventListener('blur', blur)
        }
      },
    },

    store: {
      // The host stores `null` for a deleted key and answers `null` for an unset one: both read as unset.
      get: async (key) => ((await call('runtime', 'storage.get', { key })) ?? undefined) as never,
      set: async (key, value) => {
        await call('runtime', 'storage.set', { key, value })
      },
      delete: async (key) => {
        await call('runtime', 'storage.set', { key, value: null })
      },
      onChange: (key, listener) =>
        on('storage.changed', (change) => change.plugin === 'runtime' && change.key === key && listener((change.value ?? undefined) as never)),
    },

    notifications: { send: () => unsupported('notifications') },
    shortcuts: { register: () => unsupported('global shortcuts') },
    // Updates ship as releases of the app, not through an in-app updater.
    updater: {
      check: async () => ({ kind: 'idle' }),
      install: () => unsupported('in-app updates'),
    },
    deepLinks: { initialUrl: async () => undefined, onOpen: () => noop },

    invoke: (command, args = {}) => call('runtime', command as Method, args as never),
    on: (event, listener) => on(event as EventName, listener),
  }
}
