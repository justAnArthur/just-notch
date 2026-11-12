/**
 * @just-notch/sdk — what a plugin imports. The runtime builds each plugin's
 * `PluginContext` and renders the plugin's views inside `PluginContextProvider`,
 * so the hooks below work in any of them. At runtime this module is shared
 * through the import map (one instance for the runtime and every plugin).
 */

import type { Events, EventName, Method, Methods, Topic, Topics } from '@just-notch/bridge-schema'
import { type ComponentType, createContext, createElement, type ReactNode, useContext, useEffect, useState } from 'react'

export type * from '@just-notch/bridge-schema'

export type Unsubscribe = () => void

/**
 * Who wins the island. Higher first: an `alert` interrupts everything for its
 * duration, `hud` is a key press, the rest are long-lived activities.
 */
export type Priority = 'alert' | 'hud' | 'media' | 'timer' | 'calendar' | 'device' | 'ambient'
export const PRIORITY_ORDER: Priority[] = ['alert', 'hud', 'media', 'timer', 'calendar', 'device', 'ambient']

/** What the island shows, from the smallest presentation up. */
export type IslandState = 'idle' | 'compact' | 'split' | 'expanded' | 'flash'

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

export interface PluginContext {
  readonly id: string
  /** Calls the host as this plugin; rejects when the manifest lacks the method's permission. */
  call<M extends Method>(method: M, params: Methods[M]['params']): Promise<Methods[M]['result']>
  /** Subscribes to a host topic: `cb` runs with the current value, then on every change. */
  subscribe<T extends Topic>(topic: T, cb: (value: Topics[T]) => void): Unsubscribe
  on<E extends EventName>(event: E, cb: (payload: Events[E]) => void): Unsubscribe
  readonly activity: ActivityController
  readonly storage: PluginStorage
  /** The island's current presentation, for views that adapt to it. */
  readonly island: { get(): IslandState; subscribe(cb: (state: IslandState) => void): Unsubscribe }
}

/** What the runtime passes an icon: lucide-react icons take these as they are. */
export interface IconProps {
  size?: number | string
  strokeWidth?: number | string
  className?: string
}

export interface PluginDefinition {
  /** Runs once when the plugin is enabled; return a cleanup for when it is disabled. */
  activate?(ctx: PluginContext): void | Unsubscribe | Promise<void | Unsubscribe>
  /** A tab in the expanded island. */
  widget?: { title: string; icon?: ComponentType<IconProps>; view: ComponentType }
  /** A section in the settings window. */
  settings?: ComponentType
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
