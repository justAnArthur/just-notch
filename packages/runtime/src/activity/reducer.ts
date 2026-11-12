import { type ActivitySpec, type FlashSpec, type IslandState, PRIORITY_ORDER, type Priority } from '@just-notch/sdk'

export const FLASH_MS = 2000

export interface ActivityEntry {
  plugin: string
  spec: ActivitySpec
  /** Order of the last `show`: the most recent wins a priority tie. */
  seq: number
}

export interface FlashEntry {
  /** New for every flash, also a keyed replacement, so its timer restarts. */
  id: number
  plugin: string
  spec: FlashSpec
}

export interface ActivityState {
  seq: number
  activities: ActivityEntry[]
  flash: FlashEntry | null
  queue: FlashEntry[]
  expanded: boolean
}

export type ActivityAction =
  | { type: 'show'; plugin: string; spec: ActivitySpec }
  | { type: 'hide'; plugin: string }
  | { type: 'flash'; plugin: string; spec: FlashSpec }
  | { type: 'flashEnd'; id: number }
  | { type: 'remove'; plugin: string }
  | { type: 'expand' }
  | { type: 'collapse' }

export const initialState: ActivityState = { seq: 0, activities: [], flash: null, queue: [], expanded: false }

const rankOf = (priority: Priority) => PRIORITY_ORDER.indexOf(priority)

const sameKey = (a: FlashEntry, plugin: string, spec: FlashSpec) =>
  spec.key !== undefined && a.plugin === plugin && a.spec.key === spec.key

/** Higher priority first, then first come first served. */
const byFlashOrder = (a: FlashEntry, b: FlashEntry) => rankOf(a.spec.priority) - rankOf(b.spec.priority) || a.id - b.id

function advance(state: ActivityState): ActivityState {
  const [next = null, ...queue] = state.queue
  return { ...state, flash: next, queue }
}

function flash(state: ActivityState, plugin: string, spec: FlashSpec): ActivityState {
  const seq = state.seq + 1
  const entry: FlashEntry = { id: seq, plugin, spec }
  if (state.flash && sameKey(state.flash, plugin, spec)) return { ...state, seq, flash: entry }
  const queued = state.queue.findIndex((f) => sameKey(f, plugin, spec))
  if (queued >= 0) return { ...state, seq, queue: state.queue.map((f, i) => (i === queued ? { ...entry, id: f.id } : f)).sort(byFlashOrder) }
  if (!state.flash) return { ...state, seq, flash: entry }
  return { ...state, seq, queue: [...state.queue, entry].sort(byFlashOrder) }
}

export function reduce(state: ActivityState, action: ActivityAction): ActivityState {
  switch (action.type) {
    case 'show': {
      const seq = state.seq + 1
      const activities = [...state.activities.filter((a) => a.plugin !== action.plugin), { plugin: action.plugin, spec: action.spec, seq }]
      return { ...state, seq, activities }
    }
    case 'hide': {
      if (!state.activities.some((a) => a.plugin === action.plugin)) return state
      return { ...state, activities: state.activities.filter((a) => a.plugin !== action.plugin) }
    }
    case 'flash':
      return flash(state, action.plugin, action.spec)
    case 'flashEnd':
      return state.flash?.id === action.id ? advance(state) : state
    case 'remove': {
      const kept = {
        ...state,
        activities: state.activities.filter((a) => a.plugin !== action.plugin),
        queue: state.queue.filter((f) => f.plugin !== action.plugin),
      }
      return state.flash?.plugin === action.plugin ? advance(kept) : kept
    }
    case 'expand':
      return state.expanded ? state : { ...state, expanded: true }
    case 'collapse':
      return state.expanded ? { ...state, expanded: false } : state
  }
}

/** Activities by priority, the most recent first within one. */
export function ranked(activities: ActivityEntry[]): ActivityEntry[] {
  return [...activities].sort((a, b) => rankOf(a.spec.priority) - rankOf(b.spec.priority) || b.seq - a.seq)
}

export interface Presentation {
  island: IslandState
  primary?: ActivityEntry
  /** Shown as the detached bubble: the highest-ranked other activity with a `minimal` view. */
  secondary?: ActivityEntry
  flash?: FlashEntry
}

export function present(state: ActivityState): Presentation {
  const [primary, ...rest] = ranked(state.activities)
  const secondary = rest.find((a) => a.spec.minimal)
  const flash = state.flash ?? undefined
  const island: IslandState = state.expanded ? 'expanded' : flash ? 'flash' : secondary ? 'split' : primary ? 'compact' : 'idle'
  return { island, primary, secondary, flash }
}
