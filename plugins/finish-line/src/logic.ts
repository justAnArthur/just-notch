/** A `justnotch://task/…` link from the shell hook (or any tool): a long task started, or ended. */
export type TaskLink =
  | { kind: 'start'; id: string; title: string; app?: string }
  | { kind: 'end'; id: string; title: string; app?: string; status: number; seconds?: number }

export interface RunningTask {
  id: string
  title: string
  app?: string
  startedAt: number
}

const TITLE_MAX = 120
const ID = /^[\w.-]{1,64}$/
const BUNDLE_ID = /^[A-Za-z0-9.-]{1,255}$/

/** Reads a task link; anything else (another host, a missing id) is not one. */
export function parseTaskLink(url: string): TaskLink | null {
  if (!URL.canParse(url)) return null
  const { protocol, hostname, pathname, searchParams } = new URL(url)
  if (protocol !== 'justnotch:' || hostname !== 'task') return null
  const id = searchParams.get('id') ?? ''
  if (!ID.test(id)) return null
  const title = (searchParams.get('title') ?? '').trim().slice(0, TITLE_MAX) || 'Command'
  const rawApp = searchParams.get('app') ?? ''
  const app = BUNDLE_ID.test(rawApp) ? rawApp : undefined
  const kind = pathname.replace(/^\/+/, '')
  if (kind === 'start') return { kind, id, title, app }
  if (kind !== 'end') return null
  const status = Number.parseInt(searchParams.get('status') ?? '0', 10)
  const seconds = Number.parseFloat(searchParams.get('seconds') ?? '')
  return { kind, id, title, app, status: Number.isFinite(status) ? status : 0, seconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined }
}

/** `45 s`, `2 min 13 s`, `1 h 5 min`. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`
  const m = Math.floor(s / 60)
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** `45s`, `2m`, `1h`: the compact island's figure. */
export function shortElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

/** A command that ran a shell's whole day is a closed terminal, not a task: drop it. */
export const STALE_MS = 6 * 3600_000

/** Applies a link to the running tasks; returns them and, for an end, how long the task took. */
export function apply(tasks: RunningTask[], link: TaskLink, now: number): { tasks: RunningTask[]; seconds?: number } {
  const fresh = tasks.filter((t) => now - t.startedAt < STALE_MS)
  if (link.kind === 'start') {
    if (fresh.some((t) => t.id === link.id)) return { tasks: fresh }
    return { tasks: [...fresh, { id: link.id, title: link.title, app: link.app, startedAt: now }] }
  }
  const started = fresh.find((t) => t.id === link.id)
  const seconds = link.seconds ?? (started ? (now - started.startedAt) / 1000 : undefined)
  return { tasks: fresh.filter((t) => t.id !== link.id), seconds }
}
