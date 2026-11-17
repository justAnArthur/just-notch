import type { IslandState, Sheet, Unsubscribe } from '@just-notch/sdk'
import { useSyncExternalStore } from 'react'
import { type ActivityAction, type ActivityState, FLASH_MS, initialState, present, reduce } from './reducer'

let state = initialState
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let timedFlash: number | undefined
let remaining = 0
let deadline = 0
let held = false

function runFlashTimer() {
  clearTimeout(timer)
  const flash = state.flash
  if (!flash || held) return
  deadline = Date.now() + remaining
  timer = setTimeout(() => dispatch({ type: 'flashEnd', id: flash.id }), remaining)
}

function scheduleFlashEnd() {
  const flash = state.flash
  if (flash?.id === timedFlash) return
  timedFlash = flash?.id
  remaining = flash ? (flash.spec.durationMs ?? FLASH_MS) : 0
  runFlashTimer()
}

/** While held (the pointer rests on it) the running flash doesn't time out; letting go resumes the time it had left. */
export function holdFlash(hold: boolean) {
  if (hold === held) return
  held = hold
  if (!hold) return runFlashTimer()
  clearTimeout(timer)
  if (state.flash) remaining = Math.max(0, deadline - Date.now())
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

export const getSheet = (): Sheet => (state.snap === 1 ? 'tall' : 'fit')

/** Notifies when the open island changes snap. */
export function subscribeSheet(cb: (sheet: Sheet) => void): Unsubscribe {
  let last = getSheet()
  return subscribe(() => {
    const sheet = getSheet()
    if (sheet === last) return
    last = sheet
    cb(sheet)
  })
}

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
