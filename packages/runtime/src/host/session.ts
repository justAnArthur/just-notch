import type { HostInfo, InstalledPlugin, ScreenGeometry } from '@just-notch/bridge-schema'
import { useSyncExternalStore } from 'react'
import { on } from './bus'
import { call } from './client'

function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    set(next: T) {
      value = next
      for (const listener of [...listeners]) listener()
    },
    use: () =>
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        () => value,
      ),
  }
}

const geometry = store<ScreenGeometry | undefined>(undefined)
const info = store<HostInfo | undefined>(undefined)
const installed = store<InstalledPlugin[]>([])

/** `host.ready`: the host answers with its plugins and the screen; both follow the host's events from then on. */
export async function ready(): Promise<HostInfo> {
  const answer = await call('runtime', 'host.ready', {})
  info.set(answer)
  geometry.set(answer.geometry)
  installed.set(answer.plugins)
  on('geometry', geometry.set)
  on('plugins.changed', ({ plugins }) => installed.set(plugins))
  return answer
}

export const useGeometry = geometry.use
export const useHostInfo = info.use
/** Every installed plugin, enabled or not, in the host's order. */
export const useInstalled = installed.use
