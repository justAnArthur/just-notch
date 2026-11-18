import type { Host, Unsubscribe } from '@just-apps/host-contract'
import type { EventName, Method } from '@just-notch/bridge-schema'
import { on } from './bus'
import { call } from './client'

const noop: Unsubscribe = () => {}

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
      openPath: async (path, app) => {
        await call('runtime', 'files.open', app ? { path, app } : { path })
      },
    },

    clipboard: {
      writeText: async (text) => {
        await call('runtime', 'clipboard.writeText', { text })
      },
      readText: async () => (await call('runtime', 'clipboard.readText', {})).text,
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

    notifications: {
      send: async (notification) => {
        await call('runtime', 'notifications.send', notification)
      },
    },
    shortcuts: {
      register: async (accelerator, handler) => {
        const { id } = await call('runtime', 'shortcuts.register', { accelerator })
        const stop = on('shortcut', (pressed) => pressed.id === id && handler())
        return () => {
          stop()
          void call('runtime', 'shortcuts.unregister', { id }).catch(() => {})
        }
      },
    },
    // Sparkle installs in its own window; the page follows its steps until the session settles.
    updater: {
      check: () => call('runtime', 'updater.check', {}),
      install: async (onState) => {
        const stop = on('updater.state', (state) => {
          onState(state)
          if (state.kind !== 'downloading' && state.kind !== 'checking') stop()
        })
        await call('runtime', 'updater.install', {}).catch((error) => {
          stop()
          throw error
        })
      },
    },
    deepLinks: {
      initialUrl: async () => (await call('runtime', 'deepLinks.initial', {})).url ?? undefined,
      onOpen: (listener) => on('deepLink.open', ({ url }) => listener(url)),
    },

    invoke: (command, args = {}) => call('runtime', command as Method, args as never),
    on: (event, listener) => on(event as EventName, listener),
  }
}
