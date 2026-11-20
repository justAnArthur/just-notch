import { type PluginContext, signal, type Unsubscribe } from '@just-notch/sdk'
import { bindings, COMMANDS } from './commands'
import { normalize } from './shortcut'

export const STORAGE = { bindings: 'hotkeys', enabled: 'hotkeysEnabled', cycling: 'cycling', ignoredApps: 'ignoredApps', tilingNoticed: 'tilingNoticed', animate: 'animate' } as const

/** Why a command's shortcut isn't working, by command id; read by the settings page. */
export const problems = signal<Record<string, string>>({})

const pauses = new Set<string>()
const pausesChanged = new Set<() => void>()

/**
 * Steps the hotkeys aside while `reason` holds, so the keys reach someone else: the settings page's recorder
 * (`recording`), or an app the user listed (`ignored`).
 */
export function pause(reason: 'recording' | 'ignored', on: boolean) {
  if (on === pauses.has(reason)) return
  if (on) pauses.add(reason)
  else pauses.delete(reason)
  for (const cb of [...pausesChanged]) cb()
}

interface Held {
  accelerator: string
  hostId: string
}

/**
 * Keeps the host's registrations in line with the stored bindings, the master switch and `pause`, and runs
 * `press` with a command id when one fires. Returns the cleanup that unregisters everything.
 */
export function startHotkeys(ctx: PluginContext, press: (command: string) => void): Unsubscribe {
  const held = new Map<string, Held>()
  let overrides: Record<string, string | null> | undefined
  let enabled = true
  let stopped = false
  let queue = Promise.resolve()

  const sync = () => {
    queue = queue.then(apply, apply)
  }

  async function apply() {
    const wanted = new Map<string, string>()
    const next: Record<string, string> = {}
    const owner = new Map<string, string>()
    if (enabled && !pauses.size && !stopped) {
      for (const [id, accelerator] of bindings(overrides)) {
        if (!accelerator) continue
        const key = normalize(accelerator)
        const first = owner.get(key)
        if (first) {
          next[id] = `Also set for ${COMMANDS.find((c) => c.id === first)!.title}`
          continue
        }
        owner.set(key, id)
        wanted.set(id, accelerator)
      }
    }
    for (const [id, h] of held) {
      if (wanted.get(id) === h.accelerator) continue
      held.delete(id)
      await ctx.call('shortcuts.unregister', { id: h.hostId }).catch(() => {})
    }
    for (const [id, accelerator] of wanted) {
      if (held.has(id)) continue
      try {
        held.set(id, { accelerator, hostId: (await ctx.call('shortcuts.register', { accelerator })).id })
      } catch (error) {
        next[id] = error instanceof Error ? error.message : String(error)
      }
    }
    problems.set(next)
  }

  const stops: Unsubscribe[] = [
    ctx.on('shortcut', ({ id }) => {
      for (const [command, h] of held) if (h.hostId === id) return press(command)
    }),
    ctx.storage.subscribe<Record<string, string | null>>(STORAGE.bindings, (value) => {
      overrides = value
      sync()
    }),
    ctx.storage.subscribe<boolean>(STORAGE.enabled, (value) => {
      enabled = value !== false
      sync()
    }),
  ]
  pausesChanged.add(sync)

  void Promise.all([ctx.storage.get<Record<string, string | null>>(STORAGE.bindings), ctx.storage.get<boolean>(STORAGE.enabled)]).then(([b, e]) => {
    overrides = b
    enabled = e !== false
    sync()
  })

  return () => {
    stopped = true
    pausesChanged.delete(sync)
    for (const stop of stops) stop()
    sync()
  }
}
