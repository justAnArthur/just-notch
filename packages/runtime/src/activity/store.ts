import type { IslandState, Unsubscribe } from '@just-notch/sdk'
import { useSyncExternalStore } from 'react'
import { type ActivityAction, type ActivityState, FLASH_MS, initialState, present, reduce } from './reducer'

let state = initialState
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let timedFlash: number | undefined

function scheduleFlashEnd() {
  const flash = state.flash
  if (flash?.id === timedFlash) return
  clearTimeout(timer)
  timedFlash = flash?.id
  if (flash) timer = setTimeout(() => dispatch({ type: 'flashEnd', id: flash.id }), flash.spec.durationMs ?? FLASH_MS)
}

export function dispatch(action: ActivityAction) {
  const next = reduce(state, action)
  if (next === state) return
  state = next
  scheduleFlashEnd()
  for (const listener of [...listeners]) listener()
}

export const getState = () => state

export function subscribe(listener: () => void): Unsubscribe {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useActivityState(): ActivityState {
  return useSyncExternalStore(subscribe, getState)
}

export const getIslandState = (): IslandState => present(state).island

/** Notifies only when the presentation changes, not on every activity update. */
export function subscribeIsland(cb: (island: IslandState) => void): Unsubscribe {
  let last = getIslandState()
  return subscribe(() => {
    const island = getIslandState()
    if (island === last) return
    last = island
    cb(island)
  })
}
