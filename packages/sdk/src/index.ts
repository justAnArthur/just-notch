/**
 * @just-notch/sdk — what a plugin imports. The runtime builds each plugin's
 * `PluginContext` and renders the plugin's views inside `PluginContextProvider`,
 * so the hooks below work in any of them. At runtime this module is shared
 * through the import map (one instance for the runtime and every plugin).
 */

import type { Events, EventName, Method, Methods, NetMethod, Topic, Topics } from '@just-notch/bridge-schema'
import { type ComponentType, createContext, createElement, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react'

export type * from '@just-notch/bridge-schema'
export { SelectRow, type SelectRowProps, SwitchRow, type SwitchRowProps } from './settings'

export type Unsubscribe = () => void

/**
 * Who wins the island. Higher first: an `alert` interrupts everything for its
 * duration, `hud` is a key press, the rest are long-lived activities.
 */
export type Priority = 'alert' | 'hud' | 'media' | 'timer' | 'calendar' | 'device' | 'ambient'
export const PRIORITY_ORDER: Priority[] = ['alert', 'hud', 'media', 'timer', 'calendar', 'device', 'ambient']

/** What the island shows, from the smallest presentation up. */
export type IslandState = 'idle' | 'compact' | 'split' | 'expanded' | 'flash'

/**
 * How tall the open island is: `fit` hugs a widget's content (up to 240 pt), `tall` is the sheet the user pulls
 * down to (about 560 pt). A widget shows more on `tall` (more rows, a longer forecast, details), not the same
 * content stretched.
 */
export type Sheet = 'fit' | 'tall'

/** A long-lived activity (Now Playing, a running timer). */
export interface ActivitySpec {
  priority: Exclude<Priority, 'alert' | 'hud'>
  /** The activity's tab label in the expanded island. Defaults to the plugin's manifest name. */
  title?: string
  /** Beside the notch while this activity owns the island. Each slot is about as wide as the notch is tall. */
  compact: { leading?: ComponentType; trailing?: ComponentType }
  /** The detached bubble when another activity owns the island (`split`). */
  minimal?: ComponentType
  /** Shown when the user expands the island while this activity is primary. */
  expanded?: ComponentType
}

/** A transient expansion: a charging alert, a volume HUD. Auto-dismisses. */
export interface FlashSpec {
  priority: 'alert' | 'hud'
  view: ComponentType
  /** @default 2000 */
  durationMs?: number
  /** A flash with the same key replaces the running one instead of queueing (a held volume key). */
  key?: string
}

export interface ActivityController {
  /** Starts or replaces this plugin's activity. */
  show(spec: ActivitySpec): void
  hide(): void
  flash(spec: FlashSpec): void
  /** Ends this plugin's running or queued flash with `key`, or every flash of this plugin without one. */
  dismiss(key?: string): void
}

export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  /** Runs `cb` with the new value whenever `key` changes, from this view or another (the settings window). */
  subscribe<T>(key: string, cb: (value: T | undefined) => void): Unsubscribe
}

/** Per-plugin strings in the Keychain (tokens, passwords). Needs the `secrets` permission. */
export interface PluginSecrets {
  /** `null` when unset. */
  get(key: string): Promise<string | null>
  /** `null` deletes. Keys match `^[A-Za-z0-9._-]{1,64}$`; values are at most 64 KB. */
  set(key: string, value: string | null): Promise<void>
  /** Runs `cb` when `key` is set or deleted, from any view; read it again with `get`. */
  subscribe(key: string, cb: () => void): Unsubscribe
}

/** `ctx.fetch`'s options: a subset of `RequestInit`, plus `json` and a timeout. */
export interface NetFetchInit {
  /** @default 'GET' */
  method?: NetMethod
  headers?: HeadersInit
  body?: string
  /** Sent as JSON with `content-type: application/json`; exclusive with `body`. */
  json?: unknown
  /** @default 15000, clamped to 1000–60000 */
  timeoutMs?: number
}

export interface PluginNet {
  /**
   * Asks the user, in a native dialog, to let this plugin reach `url`'s host (exactly that host and port).
   * Resolves `true` at once when the manifest's `hosts` or an earlier grant already cover it.
   */
  requestHost(url: string, reason?: string): Promise<boolean>
  /** The manifest's host patterns and the hosts the user granted. */
  hosts(): Promise<{ manifest: string[]; granted: string[] }>
}

export interface PluginContext {
  readonly id: string
  /** Calls the host as this plugin; rejects when the manifest lacks the method's permission. */
  call<M extends Method>(method: M, params: Methods[M]['params']): Promise<Methods[M]['result']>
  /** Subscribes to a host topic: `cb` runs with the current value, then on every change. */
  subscribe<T extends Topic>(topic: T, cb: (value: Topics[T]) => void): Unsubscribe
  on<E extends EventName>(event: E, cb: (payload: Events[E]) => void): Unsubscribe
  readonly activity: ActivityController
  readonly storage: PluginStorage
  /**
   * HTTP(S) through the host, without CORS or cookies, to the manifest's `hosts` and granted hosts (`net`).
   * `https:` only, `http:` for local hosts. Resolves with a real `Response` for any status; rejects when the
   * host isn't allowed, on network errors, timeouts, and bodies over 5 MiB.
   */
  fetch(input: string | URL, init?: NetFetchInit): Promise<Response>
  readonly net: PluginNet
  readonly secrets: PluginSecrets
  /** The island's current presentation, for views that adapt to it. */
  readonly island: { get(): IslandState; subscribe(cb: (state: IslandState) => void): Unsubscribe }
  /** The open island's snap. */
  readonly sheet: { get(): Sheet; subscribe(cb: (sheet: Sheet) => void): Unsubscribe }
}

/** What the runtime passes an icon: lucide-react icons take these as they are. */
export interface IconProps {
  size?: number | string
  strokeWidth?: number | string
  className?: string
}

/** Something a search result does; a result's first action runs on ↩, its second on ⌘↩, its third on ⇧↩. */
export interface SearchAction {
  /** Shown beside the selected result and in its actions list: `Paste`, `Copy`, `Open in browser`. */
  title: string
  run(): void | Promise<void>
}

/** One row in the launcher's results. */
export interface SearchItem {
  /** Stable across searches: the launcher remembers what the user picks by it. */
  id: string
  title: string
  subtitle?: string
  /** A `data:` or `https:` image, or an icon component. */
  icon?: string | ComponentType<IconProps>
  /** Short text at the row's end, such as a date or a kind. */
  accessory?: string
  actions: SearchAction[]
}

/**
 * A plugin's scope in the launcher: a round button beside the search bar (⌘1–⌘9 in Settings' order) and, unless
 * `root` is false, a few rows under its title in every search.
 */
export interface SearchProvider {
  title: string
  icon?: ComponentType<IconProps>
  /** Typing one of these and a space enters the scope: `clip `. */
  keywords?: string[]
  /** Rows in the root search, under the title; `false` keeps them inside the scope. Default 3. */
  root?: { limit: number } | false
  /**
   * The results for `query` (empty inside the scope before typing: show the newest). Runs on every keystroke;
   * `signal` aborts when a newer query replaces it. Slow providers are shown when they answer.
   */
  provide(query: string, env: { ctx: PluginContext; signal: AbortSignal }): SearchItem[] | Promise<SearchItem[]>
}

export interface PluginDefinition {
  /** Runs once when the plugin is enabled; return a cleanup for when it is disabled. */
  activate?(ctx: PluginContext): void | Unsubscribe | Promise<void | Unsubscribe>
  /** A tab in the expanded island. */
  widget?: { title: string; icon?: ComponentType<IconProps>; view: ComponentType }
  /** A section in the settings window. */
  settings?: ComponentType
  /** A scope in the launcher (plugin API 1.2). */
  search?: SearchProvider
}

export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition
}

const Context = createContext<PluginContext | null>(null)

/** Runtime only: scopes the hooks below to one plugin. */
export function PluginContextProvider({ value, children }: { value: PluginContext; children?: ReactNode }) {
  return createElement(Context.Provider, { value }, children)
}

export function usePlugin(): PluginContext {
  const ctx = useContext(Context)
  if (!ctx) throw new Error('@just-notch/sdk hooks must render inside a plugin view')
  return ctx
}

/** The latest value of a host topic, or `undefined` until the first one arrives. */
export function useTopic<T extends Topic>(topic: T): Topics[T] | undefined {
  const ctx = usePlugin()
  const [value, setValue] = useState<Topics[T]>()
  useEffect(() => ctx.subscribe(topic, setValue), [ctx, topic])
  return value
}

export function useHostEvent<E extends EventName>(event: E, cb: (payload: Events[E]) => void) {
  const ctx = usePlugin()
  useEffect(() => ctx.on(event, cb), [ctx, event, cb])
}

export function useIslandState(): IslandState {
  const { island } = usePlugin()
  const [state, setState] = useState(island.get)
  useEffect(() => island.subscribe(setState), [island])
  return state
}

/** The open island's snap, for a widget that lays out more on `tall`. */
export function useSheet(): Sheet {
  const { sheet } = usePlugin()
  const [value, setValue] = useState(sheet.get)
  useEffect(() => sheet.subscribe(setValue), [sheet])
  return value
}

/** Persisted per-plugin state: `[value, set]`, `fallback` until storage answers. */
export function useStorage<T>(key: string, fallback: T): [T, (value: T) => void] {
  const { storage } = usePlugin()
  const [value, setValue] = useState(fallback)
  useEffect(() => {
    let live = true
    storage.get<T>(key).then((stored) => live && stored !== undefined && setValue(stored))
    const stop = storage.subscribe<T>(key, (next) => setValue(next === undefined ? fallback : next))
    return () => {
      live = false
      stop()
    }
    // `fallback` stays out of the deps: a new literal each render must not resubscribe.
  }, [storage, key])
  const set = (next: T) => {
    setValue(next)
    void storage.set(key, next)
  }
  return [value, set]
}

/**
 * A Keychain secret: `[value, set, loading]`. `value` is `null` while unset (and while loading);
 * `set(null)` deletes. Follows changes from other views (the settings page).
 */
export function useSecret(key: string): [string | null, (value: string | null) => Promise<void>, boolean] {
  const { secrets } = usePlugin()
  const [state, setState] = useState<{ value: string | null; loading: boolean }>({ value: null, loading: true })
  useEffect(() => {
    let live = true
    const load = () =>
      secrets.get(key).then(
        (value) => live && setState({ value, loading: false }),
        () => live && setState({ value: null, loading: false }),
      )
    void load()
    const stop = secrets.subscribe(key, load)
    return () => {
      live = false
      stop()
    }
  }, [secrets, key])
  const set = async (value: string | null) => {
    await secrets.set(key, value)
    setState({ value, loading: false })
  }
  return [state.value, set, state.loading]
}

/** Media position extrapolated from the last `MediaState`, re-read every `everyMs`. */
export function useMediaPosition(state: Topics['media'] | undefined, everyMs = 500): number {
  const [now, setNow] = useState(Date.now)
  const playing = state?.playing === true
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [playing, everyMs])
  if (!state) return 0
  const elapsed = state.playing ? ((now - state.updatedAt) / 1000) * state.rate : 0
  return Math.min(state.durationS, state.positionS + elapsed)
}

export interface Signal<T> {
  get(): T
  /** Notifies only when the value changes (`Object.is`). */
  set(value: T): void
  /** The value, re-rendering on change: how an activity's views read what `activate` keeps. */
  use(): T
}

/** A value `activate` writes and the plugin's views read. */
export function signal<T>(initial: T): Signal<T> {
  let value = initial
  const listeners = new Set<() => void>()
  const subscribe = (cb: () => void) => {
    listeners.add(cb)
    return () => void listeners.delete(cb)
  }
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const cb of [...listeners]) cb()
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  }
}
