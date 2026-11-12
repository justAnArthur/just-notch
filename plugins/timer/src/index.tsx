import { Button, Input, Switch, SwitchGroup, spring } from '@justanarthur/modo-ui'
import { definePlugin, type PluginContext, useStorage } from '@just-notch/sdk'
import { Pause, Play, Plus, Timer as TimerIcon, X } from 'lucide-react'
import { motion } from 'motion/react'
import { type FormEvent, useEffect, useState, useSyncExternalStore } from 'react'

type Kind = 'focus' | 'break' | 'custom'

/** A running timer has `endsAt`, a paused one `remainingMs`. Persisted, so a reload resumes it. */
interface Run {
  kind: Kind
  totalMs: number
  endsAt?: number
  remainingMs?: number
}

const KEY = 'run'
const POMODORO = 'pomodoro'
const MINUTE = 60_000
const FOCUS_MIN = 25
const BREAK_MIN = 5
const STALE_MS = MINUTE
const PRESETS = [
  { minutes: 1, label: '1 min', kind: 'custom' },
  { minutes: 5, label: '5 min', kind: 'custom' },
  { minutes: 10, label: '10 min', kind: 'custom' },
  { minutes: FOCUS_MIN, label: 'Pomodoro', kind: 'focus' },
] as const
const LABEL: Record<Kind, string> = { focus: 'Focus', break: 'Break', custom: 'Timer' }

let run: Run | null = null
let persist: (next: Run | null) => void = () => {}
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

function setRun(next: Run | null) {
  run = next
  persist(next)
  for (const l of [...listeners]) l()
}

const useRun = () => useSyncExternalStore(subscribe, () => run)

const remainingOf = (r: Run, now: number) => (r.endsAt === undefined ? (r.remainingMs ?? 0) : Math.max(0, r.endsAt - now))

const start = (minutes: number, kind: Kind) => setRun({ kind, totalMs: minutes * MINUTE, endsAt: Date.now() + minutes * MINUTE })
const pause = (r: Run) => setRun({ ...r, endsAt: undefined, remainingMs: remainingOf(r, Date.now()) })
const resume = (r: Run) => setRun({ ...r, endsAt: Date.now() + (r.remainingMs ?? 0), remainingMs: undefined })
const addMinute = (r: Run) =>
  setRun({
    ...r,
    totalMs: r.totalMs + MINUTE,
    ...(r.endsAt === undefined ? { remainingMs: (r.remainingMs ?? 0) + MINUTE } : { endsAt: r.endsAt + MINUTE }),
  })

/** Re-renders once per shown second, on the second's edge (counted from the end), never in between. */
function useRemaining(r: Run) {
  const [now, setNow] = useState(Date.now)
  const { endsAt } = r
  useEffect(() => {
    if (endsAt === undefined) return
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const t = Date.now()
      setNow(t)
      timer = setTimeout(tick, (endsAt - t) % 1000 || 1000)
    }
    tick()
    return () => clearTimeout(timer)
  }, [endsAt])
  return remainingOf(r, endsAt === undefined ? Date.now() : now)
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Ring({ r, className, stroke }: { r: Run; className: string; stroke: number }) {
  const remaining = useRemaining(r)
  const radius = 12 - stroke / 2
  const c = 2 * Math.PI * radius
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 -rotate-90 text-status-warning`} aria-label={`${clock(remaining)} left`}>
      <circle cx="12" cy="12" r={radius} fill="none" className="stroke-active" strokeWidth={stroke} />
      {/* Set, not sprung: a spring per tick repainted the ring most of every second for a sub-pixel change. */}
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        className="stroke-current"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - remaining / r.totalMs)}
      />
    </svg>
  )
}

function Minimal() {
  const r = useRun()
  return r ? <Ring r={r} className="size-5.5" stroke={3} /> : null
}

function Leading() {
  return <TimerIcon size={16} strokeWidth={1.5} className="text-status-warning" />
}

function Trailing() {
  const r = useRun()
  return r ? <Countdown r={r} className="text-caption weight-medium" /> : null
}

function Countdown({ r, className }: { r: Run; className: string }) {
  const remaining = useRemaining(r)
  const paused = r.endsAt === undefined
  return <span className={`${className} tabular-nums ${paused ? 'text-muted-foreground' : 'text-status-warning'}`}>{clock(remaining)}</span>
}

function Running({ r }: { r: Run }) {
  const paused = r.endsAt === undefined
  return (
    <div className="flex size-full items-center gap-5">
      <Ring r={r} className="size-16" stroke={2.5} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-caption text-muted-foreground">
          {LABEL[r.kind]} · {Math.round(r.totalMs / MINUTE)} min{paused ? ' · Paused' : ''}
        </span>
        <Countdown r={r} className="text-display" />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="tertiary" leadingIcon={Plus} onClick={() => addMinute(r)}>
          1 min
        </Button>
        <Button variant="tertiary" size="icon" className="text-status-warning" aria-label={paused ? 'Resume' : 'Pause'} onClick={() => (paused ? resume(r) : pause(r))}>
          {paused ? <Play size={16} strokeWidth={1.5} fill="currentColor" /> : <Pause size={16} strokeWidth={1.5} fill="currentColor" />}
        </Button>
        <Button variant="tertiary" size="icon" aria-label="Cancel" onClick={() => setRun(null)}>
          <X size={16} strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  )
}

function Expanded() {
  const r = useRun()
  return r ? <Running r={r} /> : null
}

function Picker() {
  const [minutes, setMinutes] = useState('')
  const value = Number(minutes)
  const valid = Number.isInteger(value) && value >= 1 && value <= 99
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid) start(value, 'custom')
  }
  return (
    <div className="flex size-full flex-col justify-center gap-3">
      <div className="grid grid-cols-4 gap-2">
        {PRESETS.map((p) => (
          <Button key={p.label} variant="tertiary" onClick={() => start(p.minutes, p.kind)}>
            {p.label}
          </Button>
        ))}
      </div>
      <form className="flex items-center gap-2" onSubmit={submit}>
        <Input
          className="min-w-0 flex-1"
          variant="bordered"
          type="number"
          inputMode="numeric"
          min={1}
          max={99}
          placeholder="Custom minutes"
          aria-label="Custom minutes"
          value={minutes}
          onChange={setMinutes}
        />
        <Button type="submit" variant="primary" leadingIcon={Play} disabled={!valid}>
          Start
        </Button>
      </form>
    </div>
  )
}

function Widget() {
  const r = useRun()
  return r ? <Running r={r} /> : <Picker />
}

let finished: { kind: Kind; next?: Kind } = { kind: 'custom' }

function TimeUp() {
  const detail = finished.next ? `${LABEL[finished.next]} starts now · ${finished.next === 'break' ? BREAK_MIN : FOCUS_MIN} min` : `${LABEL[finished.kind]} finished`
  return (
    <div className="flex items-center gap-3">
      <motion.span
        className="flex size-8 shrink-0 items-center justify-center text-status-warning"
        initial={{ rotate: -12 }}
        animate={{ rotate: 0 }}
        transition={spring.slow}
      >
        <TimerIcon size={20} strokeWidth={1.5} />
      </motion.span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body weight-semibold text-foreground">Time's up</span>
        <span className="truncate text-caption text-muted-foreground">{detail}</span>
      </div>
    </div>
  )
}

function Settings() {
  const [pomodoro, setPomodoro] = useStorage(POMODORO, false)
  return (
    <SwitchGroup>
      <Switch
        label="Pomodoro cycles"
        description={`After a ${FOCUS_MIN} min focus a ${BREAK_MIN} min break starts on its own, then focus again.`}
        checked={pomodoro}
        onCheckedChange={setPomodoro}
      />
    </SwitchGroup>
  )
}

function activate(ctx: PluginContext) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let shown = false

  const complete = async (r: Run) => {
    const cycle = r.kind !== 'custom' && ((await ctx.storage.get<boolean>(POMODORO)) ?? false)
    const next: Kind | undefined = cycle ? (r.kind === 'focus' ? 'break' : 'focus') : undefined
    finished = { kind: r.kind, next }
    ctx.activity.flash({ priority: 'alert', key: 'done', view: TimeUp, durationMs: 4000 })
    if (next) start(next === 'break' ? BREAK_MIN : FOCUS_MIN, next)
    else setRun(null)
  }

  const sync = () => {
    clearTimeout(timeout)
    const r = run
    if (r?.endsAt !== undefined) timeout = setTimeout(() => run === r && void complete(r), Math.max(0, r.endsAt - Date.now()))
    if (Boolean(r) === shown) return
    shown = Boolean(r)
    if (!r) return ctx.activity.hide()
    ctx.activity.show({ priority: 'timer', compact: { leading: Leading, trailing: Trailing }, minimal: Minimal, expanded: Expanded })
  }

  const stop = subscribe(sync)
  persist = (next) => void ctx.storage.set(KEY, next)

  void ctx.storage.get<Run | null>(KEY).then((stored) => {
    if (!stored || run) return
    if (stored.endsAt !== undefined && stored.endsAt < Date.now() - STALE_MS) return setRun(null)
    setRun(stored)
  })

  return () => {
    clearTimeout(timeout)
    stop()
    persist = () => {}
    ctx.activity.hide()
  }
}

export default definePlugin({
  activate,
  widget: { title: 'Timer', icon: TimerIcon, view: Widget },
  settings: Settings,
})
