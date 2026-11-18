import { useSyncExternalStore } from 'react'

/** The settings page shown, and the library plugin whose page is open; kept outside Settings, so a deep link can set them before it mounts. */
export interface SettingsTarget {
  page: string
  library?: string
}

let target: SettingsTarget = { page: 'general' }
const listeners = new Set<() => void>()

export function setSettingsTarget(next: SettingsTarget) {
  target = next
  for (const listener of [...listeners]) listener()
}

export function useSettingsTarget(): SettingsTarget {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => target,
  )
}
