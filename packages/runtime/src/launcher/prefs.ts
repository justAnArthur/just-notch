import type { FileHit } from '@just-notch/bridge-schema'
import { type Frecency, frecencyScore, type Knowledge } from './frecency'
import { normalize } from './match'
import type { Row } from './rows'
import { normalizeAccelerator } from './shortcut'

/** What the launcher keeps of a result to show and run it again without searching: in Recent, Favourites, for its alias or hotkey. */
export interface ItemSnapshot {
  id: string
  title: string
  subtitle?: string
  /** An app's or a file's path, which draws its icon and opens it. */
  path?: string
  fileKind?: FileHit['kind']
}

/** What the user set on one result. */
export interface ItemPrefs {
  /** Typing it exactly makes the result the Top Hit. */
  alias?: string
  /** A global hotkey (accelerator syntax) that runs the result's first action with the launcher closed. */
  hotkey?: string
}

/** A search the root offers when nothing (or not only something) matches: an engine or a quicklink. */
export interface Fallback {
  id: string
  title: string
  /** `https://…{query}…`: the query, URL-encoded, goes where `{query}` is. */
  url: string
  enabled: boolean
  /** Google, DuckDuckGo, Kagi: can be turned off and moved, not deleted. */
  builtIn?: boolean
}

export interface LauncherPrefs {
  items: Record<string, ItemPrefs>
  /** Favourite results, in the order the empty root shows them. */
  favourites: string[]
  fallbacks: Fallback[]
}

export const DEFAULT_FALLBACKS: Fallback[] = [
  { id: 'google', title: 'Google', url: 'https://www.google.com/search?q={query}', enabled: true, builtIn: true },
  { id: 'duckduckgo', title: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}', enabled: false, builtIn: true },
  { id: 'kagi', title: 'Kagi', url: 'https://kagi.com/search?q={query}', enabled: false, builtIn: true },
]

/** Stored preferences with what's missing filled in: a new built-in engine shows up after an update. */
export function withDefaults(stored: Partial<LauncherPrefs> | undefined): LauncherPrefs {
  const fallbacks = stored?.fallbacks ?? []
  return {
    items: stored?.items ?? {},
    favourites: stored?.favourites ?? [],
    fallbacks: [...fallbacks, ...DEFAULT_FALLBACKS.filter((d) => !fallbacks.some((f) => f.id === d.id))],
  }
}

/** The link for `query` on a fallback. */
export const fallbackUrl = (fallback: Fallback, query: string) => fallback.url.replaceAll('{query}', encodeURIComponent(query))

/** Why a quicklink's URL can't be saved, or undefined when it can. */
export function quicklinkProblem(url: string): string | undefined {
  if (!/^https?:\/\/[^\s/]+\.[^\s]+/.test(url.trim())) return 'Start it with https:// and a site.'
  if (!url.includes('{query}')) return 'Put {query} where the search goes.'
}

/**
 * The fallbacks the root shows: only the first while there are other results (it stays last), the first three when
 * nothing else matches.
 */
export const shownFallbacks = (fallbacks: Fallback[], others: boolean) => fallbacks.filter((f) => f.enabled).slice(0, others ? 1 : 3)

/** Moves the fallback at `from` one place up (-1) or down (1). */
export function moveFallback(fallbacks: Fallback[], from: number, step: -1 | 1): Fallback[] {
  const to = from + step
  if (to < 0 || to >= fallbacks.length) return fallbacks
  const next = [...fallbacks]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** The results whose alias is exactly what's typed. */
export const aliasedIds = (prefs: LauncherPrefs, query: string) => {
  const q = normalize(query)
  return q ? Object.entries(prefs.items).filter(([, p]) => p.alias && normalize(p.alias) === q).map(([id]) => id) : []
}

/** Normalizes an alias for storing: trimmed, no inner runs of space; empty clears it. */
export const cleanAlias = (alias: string) => alias.trim().replace(/\s+/g, ' ') || undefined

/**
 * What's wrong with each result's alias or hotkey, by id: the same alias or hotkey on two results, or the launcher's
 * own hotkey. `taken` adds what the host refused (another app's hotkey).
 */
export function conflicts(prefs: LauncherPrefs, titles: Record<string, string>, launcherHotkey: string | undefined, taken: Record<string, string> = {}): Record<string, string> {
  const problems: Record<string, string> = { ...taken }
  const firstAlias = new Map<string, string>()
  const firstHotkey = new Map<string, string>()
  const launcher = launcherHotkey && normalizeAccelerator(launcherHotkey)
  for (const [id, p] of Object.entries(prefs.items)) {
    if (p.alias) {
      const key = normalize(p.alias)
      const first = firstAlias.get(key)
      if (first) problems[id] = `Alias also on ${titles[first] ?? first}`
      else firstAlias.set(key, id)
    }
    if (p.hotkey) {
      const key = normalizeAccelerator(p.hotkey)
      const first = firstHotkey.get(key)
      if (key === launcher) problems[id] = 'The launcher’s own hotkey'
      else if (first) problems[id] = `Hotkey also on ${titles[first] ?? first}`
      else firstHotkey.set(key, id)
    }
  }
  return problems
}

/** The hotkeys to hold, by result id: one per hotkey, the first result that has it, never the launcher's own. */
export function heldHotkeys(prefs: LauncherPrefs, launcherHotkey: string | undefined): Map<string, string> {
  const held = new Map<string, string>()
  const used = new Set(launcherHotkey ? [normalizeAccelerator(launcherHotkey)] : [])
  for (const [id, p] of Object.entries(prefs.items)) {
    if (!p.hotkey) continue
    const key = normalizeAccelerator(p.hotkey)
    if (used.has(key)) continue
    used.add(key)
    held.set(id, p.hotkey)
  }
  return held
}

/** The empty root's Recent: the most used results lately (no favourites, only ones it can show again), 5 to 8 of them. */
export function recentIds(frecency: Frecency, snapshots: Record<string, ItemSnapshot>, favourites: string[], now = Date.now(), limit = 8): string[] {
  return Object.keys(frecency)
    .filter((id) => snapshots[id] && !favourites.includes(id))
    .map((id) => ({ id, score: frecencyScore(frecency, id, now) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.id)
}

/** Forgets a result's ranking: its launches, and what it was picked for. */
export function forget(frecency: Frecency, knowledge: Knowledge, id: string): { frecency: Frecency; knowledge: Knowledge } {
  const { [id]: _, ...rest } = frecency
  const known: Knowledge = {}
  for (const [query, picks] of Object.entries(knowledge)) {
    const { [id]: __, ...others } = picks
    if (Object.keys(others).length) known[query] = others
  }
  return { frecency: rest, knowledge: known }
}

/** Results that can be kept (apps, files, actions, Shortcuts, plugin results), not the web search, answers or errors. */
export const keepable = (row: Row) => /^(app|file|action|shortcut|plugin):/.test(row.id) && !row.failed

/** What to keep of a row; undefined for one that can't be kept. */
export function snapshotOf(row: Row): ItemSnapshot | undefined {
  if (!keepable(row)) return undefined
  const path = row.icon && 'path' in row.icon ? row.icon.path : undefined
  const kind = row.preview?.details?.find((d) => d.label === 'Kind')?.value
  const fileKind = row.id.startsWith('file:') ? FILE_KINDS[kind ?? ''] : undefined
  return { id: row.id, title: row.title, ...(row.subtitle && { subtitle: row.subtitle }), ...(path && { path }), ...(fileKind && { fileKind }) }
}

const FILE_KINDS: Record<string, FileHit['kind']> = { Folder: 'folder', Application: 'application', Image: 'image', PDF: 'pdf', Document: 'document', File: 'other' }
