import type { HostInfo, ScreenGeometry } from '@just-notch/bridge-schema'
import { useSyncExternalStore } from 'react'
import { on } from './bus'
import { call } from './client'

let geometry: ScreenGeometry | undefined
const listeners = new Set<() => void>()

function setGeometry(next: ScreenGeometry) {
  geometry = next
  for (const listener of [...listeners]) listener()
}

/** `host.ready`: the host answers with its plugins and the screen; geometry follows the screen from then on. */
export async function ready(): Promise<HostInfo> {
  const info = await call('runtime', 'host.ready', {})
  setGeometry(info.geometry)
  on('geometry', setGeometry)
  return info
}

export function useGeometry(): ScreenGeometry | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => geometry,
  )
}
