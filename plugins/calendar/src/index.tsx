import { Button, Radio, Switch, SwitchGroup } from '@justanarthur/modo-ui'
import { type CalendarEvent, type CalendarState, definePlugin, type PluginContext, usePlugin, useStorage, useTopic } from '@just-notch/sdk'
import { CalendarDays, Video } from 'lucide-react'
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'

const MINUTE = 60_000
const AFTER_START_MS = 5 * MINUTE
const ALERT_MS = MINUTE
const LEAD_OPTIONS = [5, 10, 15]
const DEFAULT_LEAD = 10
const PRIVACY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'

/** The event the activity is about; the island's views read it from here. */
let current: { event: CalendarEvent; leadMs: number } | undefined
const listeners = new Set<() => void>()
const subscribeCurrent = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function setCurrent(next: typeof current) {
  // The ticker runs every second: only an actual change may re-render the views.
  if (next?.event.id === current?.event.id && next?.event.start === current?.event.start && next?.leadMs === current?.leadMs) return
  current = next
  for (const cb of [...listeners]) cb()
}
const useCurrent = () => useSyncExternalStore(subscribeCurrent, () => current)

function useNow(everyMs = 1000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const span = (e: CalendarEvent) => (e.allDay ? 'All day' : `${clock(e.start)} – ${clock(e.end)}`)
const meta = (e: CalendarEvent) => (e.location ? `${span(e)} · ${e.location}` : span(e))

function countdown(ms: number) {
  if (ms <= 0) return 'Now'
  if (ms < MINUTE) return `${Math.ceil(ms / 1000)}s`
  return `${Math.ceil(ms / MINUTE)}m`
}

function relative(ms: number) {
  if (ms <= 0) return 'Now'
  if (ms < MINUTE) return 'In less than a minute'
  return `In ${Math.ceil(ms / MINUTE)} min`
}

function Glyph() {
  const color = useCurrent()?.event.calendarColor
  return <CalendarDays size={16} strokeWidth={1.5} style={{ color }} />
}

function Countdown() {
  const now = useNow()
  const event = useCurrent()?.event
  if (!event) return null
  return (
    <span className="text-caption weight-semibold tabular-nums" style={{ color: event.calendarColor }}>
      {countdown(event.start - now)}
    </span>
  )
}

function Ring() {
  const now = useNow()
  const entry = useCurrent()
  if (!entry) return null
  const { event, leadMs } = entry
  const left = Math.max(0, event.start - now)
  const r = 10
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 26 26" className="size-6 -rotate-90" style={{ color: event.calendarColor }} aria-label={countdown(left)}>
      <circle cx="13" cy="13" r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2.5} />
      <circle
        cx="13"
        cy="13"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (left / leadMs)}
      />
    </svg>
  )
}

function Join({ url, size = 'compact' }: { url: string; size?: 'default' | 'compact' }) {
  const { call } = usePlugin()
  return (
    <Button variant="secondary" size={size} leadingIcon={Video} onClick={() => void call('system.openUrl', { url })}>
      Join
    </Button>
  )
}

function Upcoming() {
  const now = useNow()
  const event = useCurrent()?.event
  if (!event) return null
  return (
    <div className="flex size-full items-center gap-4">
      <span className="h-14 w-1 shrink-0 rounded-full" style={{ backgroundColor: event.calendarColor }} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-caption weight-semibold tabular-nums" style={{ color: event.calendarColor }}>
          {relative(event.start - now)}
        </span>
        <span className="truncate text-title weight-semibold text-foreground">{event.title}</span>
        <span className="truncate text-body text-muted-foreground">{meta(event)}</span>
      </div>
      {event.meetingUrl && <Join url={event.meetingUrl} size="default" />}
    </div>
  )
}

function Starting() {
  const now = useNow()
  const event = useCurrent()?.event
  if (!event) return null
  return (
    <div className="flex items-center gap-3">
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: event.calendarColor }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body weight-semibold text-foreground">{event.title}</span>
        <span className="truncate text-caption text-muted-foreground">{relative(event.start - now)}</span>
      </div>
      {event.meetingUrl && <Join url={event.meetingUrl} />}
    </div>
  )
}

function Row({ event }: { event: CalendarEvent }) {
  return (
    <li className="flex h-9 items-center gap-3">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: event.calendarColor }} />
      <span className="w-16 shrink-0 whitespace-nowrap text-caption text-muted-foreground tabular-nums">{event.allDay ? 'All day' : clock(event.start)}</span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 truncate text-body text-foreground">{event.title}</span>
        {event.location && !event.meetingUrl && <span className="min-w-0 shrink-[100] truncate text-caption text-muted-foreground">{event.location}</span>}
      </span>
      {event.meetingUrl && <Join url={event.meetingUrl} />}
    </li>
  )
}

function Day({ title, events, empty }: { title: string; events: CalendarEvent[]; empty: string }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <h2 className="text-caption text-muted-foreground">{title}</h2>
      {events.length === 0 ? (
        <p className="flex h-9 items-center text-body text-muted-foreground">{empty}</p>
      ) : (
        // A plain scroller: ScrollArea's content sizes to fit-content, which would push the rows past the column.
        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {events.map((e) => (
            <Row key={e.id} event={e} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Notice({ title, lead, action }: { title: string; lead: string; action: ReactNode }) {
  return (
    <div className="flex size-full items-center justify-center gap-5">
      <CalendarDays size={28} strokeWidth={1.25} className="shrink-0 text-muted-foreground" />
      <div className="flex max-w-72 flex-col gap-1">
        <span className="text-subtitle weight-semibold text-foreground">{title}</span>
        <span className="text-caption text-muted-foreground">{lead}</span>
      </div>
      {action}
    </div>
  )
}

function Agenda() {
  const calendar = useTopic('calendar')
  const { call } = usePlugin()
  const now = useNow(MINUTE)
  if (!calendar) return null

  if (calendar.access === 'undetermined')
    return (
      <Notice
        title="See what's next"
        lead="Today's and tomorrow's events, with a countdown before each one starts."
        action={
          <Button variant="primary" onClick={() => void call('calendar.requestAccess', {})}>
            Connect calendar
          </Button>
        }
      />
    )
  if (calendar.access === 'denied')
    return (
      <Notice
        title="Calendar access is off"
        lead="Turn it on in Privacy & Security › Calendars."
        action={
          <Button variant="secondary" onClick={() => void call('system.openUrl', { url: PRIVACY_URL })}>
            Open System Settings
          </Button>
        }
      />
    )

  const midnight = new Date(now).setHours(24, 0, 0, 0)
  const live = calendar.upcoming.filter((e) => e.end > now)
  return (
    <div className="flex size-full gap-8">
      <Day title="Today" events={live.filter((e) => e.start < midnight)} empty="Nothing else today" />
      <Day title="Tomorrow" events={live.filter((e) => e.start >= midnight)} empty="Nothing planned" />
    </div>
  )
}

function Settings() {
  const [lead, setLead] = useStorage('leadMinutes', DEFAULT_LEAD)
  const [flash, setFlash] = useStorage('flash', true)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-body text-muted-foreground">Show the countdown</span>
        <Radio.Group value={String(lead)} onValueChange={(v) => setLead(Number(v))}>
          {LEAD_OPTIONS.map((m) => (
            <Radio key={m} value={String(m)} label={`${m} minutes before`} />
          ))}
        </Radio.Group>
      </div>
      <SwitchGroup>
        <Switch
          label="Alert a minute before"
          description="Expands the island when an event is about to start."
          checked={flash}
          onCheckedChange={setFlash}
        />
      </SwitchGroup>
    </div>
  )
}

function pick(state: CalendarState | undefined, now: number, leadMs: number) {
  const due = (state?.upcoming ?? []).filter((e) => !e.allDay && now >= e.start - leadMs && now < e.start + AFTER_START_MS)
  return due.find((e) => e.start > now) ?? due[0]
}

function activate(ctx: PluginContext) {
  let state: CalendarState | undefined
  let leadMs = DEFAULT_LEAD * MINUTE
  let flashOn = true
  let shown: string | undefined
  const alerted = new Set<string>()

  const readSettings = async () => {
    leadMs = ((await ctx.storage.get<number>('leadMinutes')) ?? DEFAULT_LEAD) * MINUTE
    flashOn = (await ctx.storage.get<boolean>('flash')) ?? true
  }

  const tick = () => {
    const now = Date.now()
    const event = pick(state, now, leadMs)
    if (!event) {
      if (shown) ctx.activity.hide()
      shown = undefined
      setCurrent(undefined)
      return
    }
    setCurrent({ event, leadMs })
    if (shown !== event.id) {
      shown = event.id
      ctx.activity.show({ priority: 'calendar', title: 'Up next', compact: { leading: Glyph, trailing: Countdown }, minimal: Ring, expanded: Upcoming })
    }
    const left = event.start - now
    if (flashOn && left > 0 && left <= ALERT_MS && !alerted.has(event.id)) {
      alerted.add(event.id)
      ctx.activity.flash({ priority: 'alert', view: Starting, durationMs: 5000, key: 'starting' })
    }
  }

  const stopTopic = ctx.subscribe('calendar', (value) => {
    state = value
    tick()
  })
  const stopLead = ctx.storage.subscribe<number>('leadMinutes', (minutes) => {
    leadMs = (minutes ?? DEFAULT_LEAD) * MINUTE
    tick()
  })
  const stopFlash = ctx.storage.subscribe<boolean>('flash', (on) => {
    flashOn = on ?? true
  })
  void readSettings().then(tick)
  const ticker = setInterval(tick, 1000)
  return () => {
    stopTopic()
    stopLead()
    stopFlash()
    clearInterval(ticker)
    ctx.activity.hide()
    setCurrent(undefined)
  }
}

export default definePlugin({
  activate,
  widget: { title: 'Calendar', icon: CalendarDays, view: Agenda },
  settings: Settings,
})
