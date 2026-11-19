import type { AppInfo } from '@just-notch/bridge-schema'
import { useEffect, useState } from 'react'
import { on } from '../host/bus'
import { call } from '../host/client'
import { type Frecency, frecencyScore, rankScore, record } from './frecency'
import { bestScore } from './match'

/** Icons at 28 pt on a Retina screen. */
const ICON_SIZE = 56
const FRECENCY_KEY = 'launcher.frecency'

export interface AppResult {
  id: string
  app: AppInfo & { path: string }
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
    const score = rankScore(bestScore(query, app.name, app.keywords), frecencyScore(frecency, id))
    if (score > 0) results.push({ id, app: { ...app, path: app.path }, score })
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

/** Launch history in the runtime's storage, shared by every screen's panel. */
export function useFrecency(): [Frecency, (id: string) => void] {
  const [frecency, setFrecency] = useState<Frecency>({})
  useEffect(() => {
    void call('runtime', 'storage.get', { key: FRECENCY_KEY }).then((value) => value && setFrecency(value as Frecency), () => {})
    return on('storage.changed', ({ plugin, key, value }) => {
      if (plugin === 'runtime' && key === FRECENCY_KEY && value) setFrecency(value as Frecency)
    })
  }, [])
  const launched = (id: string) => {
    const next = record(frecency, id)
    setFrecency(next)
    void call('runtime', 'storage.set', { key: FRECENCY_KEY, value: next }).catch(() => {})
  }
  return [frecency, launched]
}
