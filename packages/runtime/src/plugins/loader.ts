import type { InstalledPlugin } from '@just-notch/bridge-schema'
import type { PluginContext, PluginDefinition, Unsubscribe } from '@just-notch/sdk'
import { useSyncExternalStore } from 'react'
import { dispatch } from '../activity/store'
import { log } from '../host/client'
import { createPluginContext } from './context'

export interface LoadedPlugin {
  installed: InstalledPlugin
  definition: PluginDefinition
  ctx: PluginContext
}

interface Running extends LoadedPlugin {
  cleanup?: void | Unsubscribe
  release(): void
  style?: HTMLLinkElement
}

const running = new Map<string, Running>()
let snapshot: LoadedPlugin[] = []
const listeners = new Set<() => void>()

/** Publishes the running plugins in the host's order, not the order their imports happened to finish. */
function changed(order: InstalledPlugin[]) {
  snapshot = order.flatMap((p) => running.get(p.manifest.id) ?? [])
  for (const listener of [...listeners]) listener()
}

function injectStyle(href: string) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.append(link)
  return link
}

/** Imports a plugin's module; the version busts the module cache after an update. */
export async function importPlugin({ manifest, baseUrl }: InstalledPlugin): Promise<PluginDefinition> {
  const url = new URL(manifest.entry, baseUrl)
  url.searchParams.set('v', manifest.version)
  const module = await import(/* @vite-ignore */ url.href)
  if (typeof module.default !== 'object' || module.default === null) throw new Error('the entry has no default export')
  return module.default
}

async function start(installed: InstalledPlugin, live: boolean) {
  const { manifest, baseUrl } = installed
  const style = manifest.style ? injectStyle(new URL(manifest.style, baseUrl).href) : undefined
  try {
    const definition = await importPlugin(installed)
    const { ctx, release } = createPluginContext(installed, live)
    const entry: Running = { installed, definition, ctx, release, style }
    running.set(manifest.id, entry)
    if (live) entry.cleanup = await definition.activate?.(ctx)
  } catch (error) {
    style?.remove()
    running.delete(manifest.id)
    log('error', `plugin ${manifest.id} failed to start: ${error instanceof Error ? error.stack ?? error.message : error}`)
  }
}

function stop(id: string) {
  const entry = running.get(id)
  if (!entry) return
  running.delete(id)
  try {
    if (typeof entry.cleanup === 'function') entry.cleanup()
  } catch (error) {
    log('error', `plugin ${id} cleanup threw: ${error}`)
  }
  entry.release()
  entry.style?.remove()
  dispatch({ type: 'remove', plugin: id })
}

let queue = Promise.resolve()

/**
 * Brings the running set in line with the host's list: stops what was disabled
 * or removed (or changed version), starts what is newly enabled. An incompatible
 * plugin is listed but never loaded. Calls are
 * serialized, so a `plugins.changed` mid-load waits for the load to finish.
 * `live: false` loads without activating (the settings page).
 */
export function syncPlugins(plugins: InstalledPlugin[], live = true) {
  queue = queue.then(async () => {
    const wanted = new Map(plugins.filter((p) => p.enabled && !p.incompatible).map((p) => [p.manifest.id, p]))
    for (const [id, entry] of running) {
      const next = wanted.get(id)
      if (!next || next.manifest.version !== entry.installed.manifest.version || next.baseUrl !== entry.installed.baseUrl) stop(id)
    }
    await Promise.all([...wanted.values()].filter((p) => !running.has(p.manifest.id)).map((p) => start(p, live)))
    changed(plugins)
  })
  return queue
}

export function usePlugins(): LoadedPlugin[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
  )
}

export const getPlugin = (id: string): LoadedPlugin | undefined => running.get(id)
