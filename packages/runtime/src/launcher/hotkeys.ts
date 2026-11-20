import { useEffect, useRef } from 'react'
import { on } from '../host/bus'
import { call } from '../host/client'
import { heldHotkeys } from './prefs'
import type { Row } from './rows'
import type { LauncherStore } from './store'

/** Which screen's panel holds the results' hotkeys: one does, or every press would run once per screen. */
const LEASE_KEY = 'launcher.hotkeyOwner'
/** What the host refused, by result id ("taken by another app"), for Settings. */
export const PROBLEMS_KEY = 'launcher.hotkeyProblems'
const BEAT_MS = 10_000
/** A lease not renewed for this long is free: its panel went with its screen. */
const LEASE_MS = 3 * BEAT_MS

interface Lease {
  screenId: string
  at: number
}

/** Whether `me` may hold the hotkeys: nobody does, it does already, or the holder stopped renewing. */
export const mayHold = (lease: Lease | null | undefined, me: string, now = Date.now()) => !lease || lease.screenId === me || now - lease.at > LEASE_MS

/**
 * Holds every result's hotkey (from ⌘K or Settings) while this panel has the lease, and runs the result when one is
 * pressed, with the launcher closed. Survives a relaunch: the hotkeys are in storage and taken again on start.
 */
export function useItemHotkeys(store: LauncherStore, screenId: string, resolve: (id: string) => Row | undefined, run: (row: Row) => void) {
  const latest = useRef({ store, resolve, run })
  latest.current = { store, resolve, run }
  const sync = useRef<() => void>(() => {})

  useEffect(() => {
    let stopped = false
    let owner = false
    /** Result id → the accelerator held and the host's id for it. */
    const held = new Map<string, { accelerator: string; hostId: string }>()
    let queue = Promise.resolve()
    let problems = '{}'

    const apply = async () => {
      const lease = (await call('runtime', 'storage.get', { key: LEASE_KEY }).catch(() => null)) as Lease | null
      owner = !stopped && mayHold(lease, screenId)
      if (owner) await call('runtime', 'storage.set', { key: LEASE_KEY, value: { screenId, at: Date.now() } }).catch(() => {})
      const launcherHotkey = owner ? ((await call('runtime', 'app.preferences', {}).catch(() => undefined))?.launcher.shortcut ?? undefined) : undefined
      const wanted = owner ? heldHotkeys(latest.current.store.prefs, launcherHotkey) : new Map<string, string>()
      for (const [id, h] of held) {
        if (wanted.get(id) === h.accelerator) continue
        held.delete(id)
        await call('runtime', 'shortcuts.unregister', { id: h.hostId }).catch(() => {})
      }
      const refused: Record<string, string> = {}
      for (const [id, accelerator] of wanted) {
        if (held.has(id)) continue
        try {
          held.set(id, { accelerator, hostId: (await call('runtime', 'shortcuts.register', { accelerator })).id })
        } catch (error) {
          refused[id] = error instanceof Error ? error.message : String(error)
        }
      }
      const next = JSON.stringify(refused)
      if (owner && next !== problems) {
        problems = next
        await call('runtime', 'storage.set', { key: PROBLEMS_KEY, value: refused }).catch(() => {})
      }
    }
    sync.current = () => {
      queue = queue.then(apply, apply)
    }
    sync.current()
    const beat = setInterval(sync.current, BEAT_MS)
    const stopPress = on('shortcut', ({ id }) => {
      for (const [itemId, h] of held) {
        if (h.hostId !== id) continue
        const row = latest.current.resolve(itemId)
        if (row) latest.current.run(row)
        return
      }
    })
    return () => {
      stopped = true
      clearInterval(beat)
      stopPress()
      void queue.then(async () => {
        for (const h of held.values()) await call('runtime', 'shortcuts.unregister', { id: h.hostId }).catch(() => {})
        if (owner) await call('runtime', 'storage.set', { key: LEASE_KEY, value: null }).catch(() => {})
      })
    }
  }, [screenId])

  // A hotkey set or changed (here, in another panel or in Settings) is taken at once.
  const signature = JSON.stringify(Object.entries(store.prefs.items).map(([id, p]) => [id, p.hotkey ?? '']))
  useEffect(() => sync.current(), [signature])
}
