import { type ActivitySpec, type FlashSpec, type IslandState, PRIORITY_ORDER, type Priority } from '@just-notch/sdk'

export const FLASH_MS = 2000

/** The open island's snap points: 0 fits the tab's content, 1 is the tall sheet. */
export type Snap = 0 | 1
/** The settings page's tab id; it opens on the tall snap, every other tab on the first. */
export const SETTINGS_TAB = 'settings'
export const defaultSnap = (tab: string | null): Snap => (tab === SETTINGS_TAB ? 1 : 0)

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
  /** The activity the user swapped into the island over the ranking; kept until the set of activities changes. */
  promoted: string | null
  /** While expanded: how tall the sheet is, and the tab it shows (`null`: the first one). */
  snap: Snap
  tab: string | null
}

export type ActivityAction =
  | { type: 'show'; plugin: string; spec: ActivitySpec }
  | { type: 'hide'; plugin: string }
  | { type: 'flash'; plugin: string; spec: FlashSpec }
  | { type: 'flashEnd'; id: number }
  | { type: 'dismiss'; plugin: string; key?: string }
  | { type: 'remove'; plugin: string }
  /** Opens the island, on `tab` (and its default snap) when given. */
  | { type: 'expand'; tab?: string }
  | { type: 'collapse' }
  | { type: 'snap'; snap: Snap }
  /** Selects a tab, at its default snap. */
  | { type: 'tab'; tab: string }
  /** Swaps the primary activity and the bubble of a split island. */
  | { type: 'swap' }

export const initialState: ActivityState = { seq: 0, activities: [], flash: null, queue: [], expanded: false, promoted: null, snap: 0, tab: null }

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
      const known = state.activities.some((a) => a.plugin === action.plugin)
      const activities = [...state.activities.filter((a) => a.plugin !== action.plugin), { plugin: action.plugin, spec: action.spec, seq }]
      return { ...state, seq, activities, promoted: known ? state.promoted : null }
    }
    case 'hide': {
      if (!state.activities.some((a) => a.plugin === action.plugin)) return state
      return { ...state, activities: state.activities.filter((a) => a.plugin !== action.plugin), promoted: null }
    }
    case 'flash':
      return flash(state, action.plugin, action.spec)
    case 'flashEnd':
      return state.flash?.id === action.id ? advance(state) : state
    case 'dismiss': {
      const matches = (f: FlashEntry) => f.plugin === action.plugin && (action.key === undefined || f.spec.key === action.key)
      if (!state.queue.some(matches) && !(state.flash && matches(state.flash))) return state
      const kept = { ...state, queue: state.queue.filter((f) => !matches(f)) }
      return state.flash && matches(state.flash) ? advance(kept) : kept
    }
    case 'remove': {
      const activities = state.activities.filter((a) => a.plugin !== action.plugin)
      const kept = {
        ...state,
        activities,
        queue: state.queue.filter((f) => f.plugin !== action.plugin),
        promoted: activities.length === state.activities.length ? state.promoted : null,
      }
      return state.flash?.plugin === action.plugin ? advance(kept) : kept
    }
    case 'expand':
      if (action.tab !== undefined) return { ...state, expanded: true, tab: action.tab, snap: defaultSnap(action.tab) }
      return state.expanded ? state : { ...state, expanded: true, snap: defaultSnap(state.tab) }
    case 'collapse':
      return state.expanded ? { ...state, expanded: false } : state
    case 'snap':
      return state.expanded && state.snap !== action.snap ? { ...state, snap: action.snap } : state
    case 'tab':
      return state.tab === action.tab ? state : { ...state, tab: action.tab, snap: defaultSnap(action.tab) }
    case 'swap': {
      const { primary, secondary } = present(state)
      // The primary becomes the bubble, so it needs a minimal view of its own.
      if (!primary?.spec.minimal || !secondary) return state
      const promoted = secondary.plugin === ranked(state.activities)[0]?.plugin ? null : secondary.plugin
      return { ...state, promoted }
    }
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
  const order = ranked(state.activities)
  const lead = order.find((a) => a.plugin === state.promoted)
  const [primary, ...rest] = lead ? [lead, ...order.filter((a) => a !== lead)] : order
  const secondary = rest.find((a) => a.spec.minimal)
  const flash = state.flash ?? undefined
  const island: IslandState = state.expanded ? 'expanded' : flash ? 'flash' : secondary ? 'split' : primary ? 'compact' : 'idle'
  return { island, primary, secondary, flash }
}
