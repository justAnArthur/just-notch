import { advancePomodoro, Clock, type ClockZone, type PomodoroRun, type PomodoroSettings, resumePomodoro } from '@justanarthur/modo-ui-notch'
import { Button, List } from '@justanarthur/modo-ui'
import { definePlugin, type PluginContext, SelectRow, signal, SwitchRow, useStorage } from '@just-notch/sdk'
import { Clock3, X } from 'lucide-react'

const RUN = 'run'
const FORMAT = 'format'
const SECONDS = 'seconds'
const ZONES = 'zones'
const POMODORO = 'pomodoro'
const AUTO_BREAK = 'autoBreak'

type Format = 'auto' | '12' | '24'
const DEFAULT_POMODORO: PomodoroSettings = { focus: 25, shortBreak: 5, longBreak: 15, rounds: 4 }
const MAX_ZONES = 3

const CITIES: ClockZone[] = [
  { city: 'San Francisco', timeZone: 'America/Los_Angeles' },
  { city: 'Chicago', timeZone: 'America/Chicago' },
  { city: 'New York', timeZone: 'America/New_York' },
  { city: 'São Paulo', timeZone: 'America/Sao_Paulo' },
  { city: 'London', timeZone: 'Europe/London' },
  { city: 'Berlin', timeZone: 'Europe/Berlin' },
  { city: 'Bratislava', timeZone: 'Europe/Bratislava' },
  { city: 'Kyiv', timeZone: 'Europe/Kyiv' },
  { city: 'Dubai', timeZone: 'Asia/Dubai' },
  { city: 'Mumbai', timeZone: 'Asia/Kolkata' },
  { city: 'Singapore', timeZone: 'Asia/Singapore' },
  { city: 'Tokyo', timeZone: 'Asia/Tokyo' },
  { city: 'Sydney', timeZone: 'Australia/Sydney' },
]

/** The run `activate` keeps, for the activity's views. */
const current = signal<PomodoroRun | null>(null)
/** The phase that just reached zero, for the flash. */
const ended = signal<PomodoroRun | null>(null)

const hour12 = (format: Format) => (format === 'auto' ? undefined : format === '12')

function Widget() {
  const [run, setRun] = useStorage<PomodoroRun | null>(RUN, null)
  const [format] = useStorage<Format>(FORMAT, 'auto')
  const [seconds] = useStorage(SECONDS, false)
  const [zones] = useStorage<ClockZone[]>(ZONES, [])
  const [pomodoro] = useStorage(POMODORO, DEFAULT_POMODORO)
  return <Clock zones={zones} seconds={seconds} hour12={hour12(format)} pomodoro={pomodoro} value={run} onValueChange={setRun} />
}

function Leading() {
  return <Clock.Leading run={current.use()} />
}

function Trailing() {
  return <Clock.Trailing run={current.use()} />
}

function Minimal() {
  return <Clock.Minimal run={current.use()} />
}

function PhaseDone() {
  const done = ended.use()
  const [run, setRun] = useStorage<PomodoroRun | null>(RUN, null)
  const [pomodoro] = useStorage(POMODORO, DEFAULT_POMODORO)
  if (!done) return null
  // A break that started on its own needs no Start.
  const waiting = run && run.endsAt === undefined
  return <Clock.PhaseDone ended={done} pomodoro={pomodoro} onStart={waiting ? () => setRun(resumePomodoro(run)) : undefined} />
}

const minutes = (values: number[]) => values.map((m) => ({ value: String(m), label: `${m} min` }))

function Settings() {
  const [format, setFormat] = useStorage<Format>(FORMAT, 'auto')
  const [seconds, setSeconds] = useStorage(SECONDS, false)
  const [zones, setZones] = useStorage<ClockZone[]>(ZONES, [])
  const [pomodoro, setPomodoro] = useStorage(POMODORO, DEFAULT_POMODORO)
  const [autoBreak, setAutoBreak] = useStorage(AUTO_BREAK, true)
  const length = (key: keyof PomodoroSettings) => (value: string) => setPomodoro({ ...pomodoro, [key]: Number(value) })
  const addable = CITIES.filter((c) => !zones.some((z) => z.timeZone === c.timeZone))

  return (
    <List>
      <List.Section title="Clock">
        <SelectRow
          label="Time format"
          options={[
            { value: 'auto', label: 'As the system' },
            { value: '12', label: '12-hour (4:42 PM)' },
            { value: '24', label: '24-hour (16:42)' },
          ]}
          value={format}
          onValueChange={setFormat}
        />
        <SwitchRow label="Show seconds" description="The seconds tick, muted, after the minutes." checked={seconds} onCheckedChange={setSeconds} />
      </List.Section>
      <List.Section title="World clocks" aside={`${zones.length} of ${MAX_ZONES}`}>
        {zones.map((zone) => (
          <List.Row key={zone.timeZone} label={zone.city}>
            <span className="min-w-0 truncate text-caption text-muted-foreground">{zone.timeZone}</span>
            <Button variant="ghost" size="icon" aria-label={`Remove ${zone.city}`} onClick={() => setZones(zones.filter((z) => z !== zone))}>
              <X />
            </Button>
          </List.Row>
        ))}
        {zones.length < MAX_ZONES && (
          <SelectRow
            label="Add a city"
            description="Up to three beside the time."
            options={[{ value: '', label: 'Choose…' }, ...addable.map((c) => ({ value: c.timeZone, label: c.city }))]}
            value=""
            onValueChange={(timeZone) => {
              const city = CITIES.find((c) => c.timeZone === timeZone)
              if (city) setZones([...zones, city])
            }}
          />
        )}
      </List.Section>
      <List.Section title="Pomodoro">
        <SelectRow label="Focus" options={minutes([15, 20, 25, 30, 45, 50, 60])} value={String(pomodoro.focus)} onValueChange={length('focus')} />
        <SelectRow label="Short break" options={minutes([3, 5, 10])} value={String(pomodoro.shortBreak)} onValueChange={length('shortBreak')} />
        <SelectRow label="Long break" options={minutes([10, 15, 20, 30])} value={String(pomodoro.longBreak)} onValueChange={length('longBreak')} />
        <SelectRow
          label="Rounds before a long break"
          options={[2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))}
          value={String(pomodoro.rounds)}
          onValueChange={length('rounds')}
        />
        <SwitchRow
          label="Start breaks on their own"
          description="Off, a finished round waits for you to start the break."
          checked={autoBreak}
          onCheckedChange={setAutoBreak}
        />
      </List.Section>
    </List>
  )
}

/** Ends phases on time whether or not the widget is open, and shows a run in the wings. */
function activate(ctx: PluginContext) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let shown = false

  const finish = async (run: PomodoroRun) => {
    const pomodoro = (await ctx.storage.get<PomodoroSettings>(POMODORO)) ?? DEFAULT_POMODORO
    const autoBreak = (await ctx.storage.get<boolean>(AUTO_BREAK)) ?? true
    const next = advancePomodoro(run, pomodoro)
    ended.set(run)
    await ctx.storage.set(RUN, autoBreak && next.phase !== 'focus' ? resumePomodoro(next) : next)
    ctx.activity.flash({ priority: 'alert', key: 'phase', view: PhaseDone, durationMs: 8000 })
  }

  const follow = (run: PomodoroRun | null | undefined) => {
    clearTimeout(timer)
    current.set(run ?? null)
    if (run && !shown) ctx.activity.show({ priority: 'timer', title: 'Pomodoro', compact: { leading: Leading, trailing: Trailing }, minimal: Minimal, expanded: Widget })
    if (!run && shown) ctx.activity.hide()
    shown = !!run
    if (run?.endsAt !== undefined) timer = setTimeout(() => void finish(run), Math.max(0, run.endsAt - Date.now()))
  }

  const stop = ctx.storage.subscribe<PomodoroRun | null>(RUN, follow)
  void ctx.storage.get<PomodoroRun | null>(RUN).then(follow)

  return () => {
    stop()
    clearTimeout(timer)
    if (shown) ctx.activity.hide()
  }
}

export default definePlugin({
  activate,
  widget: { title: 'Clock', icon: Clock3, view: Widget },
  settings: Settings,
})
