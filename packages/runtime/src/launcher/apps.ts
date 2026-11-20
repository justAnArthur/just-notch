import type { AppInfo } from '@just-notch/bridge-schema'
import { useEffect, useState } from 'react'
import { on } from '../host/bus'
import { call } from '../host/client'
import { type Frecency, frecencyScore, rankScore } from './frecency'
import { bestScore } from './match'

/** Icons at 28 pt on a Retina screen. */
const ICON_SIZE = 56

export interface AppResult {
  id: string
  app: AppInfo & { path: string }
  /** How well the name matches, before frecency. */
  match: number
  score: number
}

/** The installed apps, asked for again each time the launcher opens (the host keeps a recent scan). */
export function useAppIndex(open: boolean): AppInfo[] {
  const [apps, setApps] = useState<AppInfo[]>([])
  useEffect(() => {
    if (open) void call('runtime', 'apps.index', {}).then(setApps, () => {})
  }, [open])
  return apps
}

export function searchApps(query: string, apps: AppInfo[], frecency: Frecency, limit: number): AppResult[] {
  if (!query.trim()) return []
  const results: AppResult[] = []
  for (const app of apps) {
    if (!app.path) continue
    const id = `app:${app.bundleId}`
    const match = bestScore(query, app.name, app.keywords)
    const score = rankScore(match, frecencyScore(frecency, id))
    if (score > 0) results.push({ id, app: { ...app, path: app.path }, match, score })
  }
  return results.sort((a, b) => b.score - a.score || a.app.name.localeCompare(b.app.name)).slice(0, limit)
}

const icons = new Map<string, string>()
const pending = new Set<string>()
const listeners = new Set<() => void>()

/** Icons for the paths shown, fetched once each and kept for the session. */
export function useIcons(paths: string[]): Map<string, string> {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1)
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }, [])
  const key = paths.join('\n')
  useEffect(() => {
    const missing = paths.filter((p) => !icons.has(p) && !pending.has(p))
    if (!missing.length) return
    for (const p of missing) pending.add(p)
    void call('runtime', 'apps.icons', { paths: missing, size: ICON_SIZE })
      .then((found) => {
        for (const [path, icon] of Object.entries(found)) icons.set(path, icon)
        for (const listener of [...listeners]) listener()
      })
      .catch(() => {})
      .finally(() => {
        for (const p of missing) pending.delete(p)
      })
  }, [key])
  return icons
}

/** A value in the runtime's storage, shared by every screen's panel and kept in step with the others. */
export function useStored<T extends object>(key: string): [T, (next: T) => void] {
  const [value, setValue] = useState<T>({} as T)
  useEffect(() => {
    void call('runtime', 'storage.get', { key }).then((stored) => stored && setValue(stored as T), () => {})
    return on('storage.changed', ({ plugin, key: changed, value: stored }) => {
      if (plugin === 'runtime' && changed === key && stored) setValue(stored as T)
    })
  }, [key])
  const save = (next: T) => {
    setValue(next)
    void call('runtime', 'storage.set', { key, value: next }).catch(() => {})
  }
  return [value, save]
}
