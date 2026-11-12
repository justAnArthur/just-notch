import { type InstalledPlugin, METHOD_PERMISSION, type Method, RUNTIME_ONLY, TOPIC_PERMISSION } from '@just-notch/bridge-schema'
import type { PluginContext, Unsubscribe } from '@just-notch/sdk'
import { dispatch, getIslandState, subscribeIsland } from '../activity/store'
import { on } from '../host/bus'
import { call, log } from '../host/client'
import { subscribeTopic } from '../host/topics'

// Subscriptions go through the context so they are ref-counted per topic.
const RUNTIME_METHODS: Method[] = [...RUNTIME_ONLY, 'subscribe', 'unsubscribe']

export interface OwnedContext {
  ctx: PluginContext
  /** Drops every subscription and listener the plugin left open. */
  release(): void
}

/**
 * The context one plugin sees. `live` is false for the settings page: there
 * the plugin's settings view can call the host and read storage, but has no
 * island to show activities on.
 */
export function createPluginContext({ manifest }: InstalledPlugin, live = true): OwnedContext {
  const id = manifest.id
  const owned = new Set<Unsubscribe>()
  const own = (unsubscribe: Unsubscribe): Unsubscribe => {
    owned.add(unsubscribe)
    return () => {
      owned.delete(unsubscribe)
      unsubscribe()
    }
  }

  const ctx: PluginContext = {
    id,
    call(method, params) {
      if (RUNTIME_METHODS.includes(method)) return Promise.reject(new Error(`${method} is not available to plugins`))
      const permission = METHOD_PERMISSION[method]
      if (permission && !manifest.permissions.includes(permission))
        return Promise.reject(new Error(`${id} needs the ${permission} permission for ${method}`))
      return call(id, method, params)
    },
    subscribe(topic, cb) {
      if (!manifest.permissions.includes(TOPIC_PERMISSION[topic])) {
        log('error', `${id} needs the ${TOPIC_PERMISSION[topic]} permission for the ${topic} topic`)
        return () => {}
      }
      return own(subscribeTopic(topic, cb))
    },
    on: (event, cb) => own(on(event, cb)),
    activity: {
      show: (spec) => live && dispatch({ type: 'show', plugin: id, spec }),
      hide: () => live && dispatch({ type: 'hide', plugin: id }),
      flash: (spec) => live && dispatch({ type: 'flash', plugin: id, spec }),
      dismiss: (key) => live && dispatch({ type: 'dismiss', plugin: id, key }),
    },
    storage: {
      get: (key) => call(id, 'storage.get', { key }) as Promise<never>,
      set: async (key, value) => {
        await call(id, 'storage.set', { key, value })
      },
      subscribe: (key, cb) => own(on('storage.changed', (change) => change.plugin === id && change.key === key && cb(change.value as never))),
    },
    island: { get: getIslandState, subscribe: (cb) => own(subscribeIsland(cb)) },
  }

  return {
    ctx,
    release() {
      for (const unsubscribe of [...owned]) unsubscribe()
      owned.clear()
    },
  }
}
