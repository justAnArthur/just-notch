import { Agenda, type AgendaEvent, formatShort, useEdgeClock } from '@justanarthur/modo-ui-notch'
import { List } from '@justanarthur/modo-ui'
import { type CalendarEvent, definePlugin, type PluginContext, SelectRow, signal, SwitchRow, usePlugin, useSheet, useStorage, useTopic } from '@just-notch/sdk'
import { CalendarDays } from 'lucide-react'
import type { ReactNode } from 'react'
import { ringFigure } from './wings'

const MINUTE = 60_000
/** The activity stays this long into the event, for a late Join. */
const AFTER_START_MS = 5 * MINUTE
const ALERT_MS = MINUTE
const PRIVACY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'

const LEAD = 'leadMinutes'
const ALERT = 'alertBefore'
const ALL_DAY = 'includeAllDay'

const toEvent = (e: CalendarEvent): AgendaEvent => ({ ...e, color: e.calendarColor })

/** The event the activity counts down to. */
const next = signal<AgendaEvent | undefined>(undefined)

function useActions() {
  const { call } = usePlugin()
  return {
    onRequestAccess: () => void call('calendar.requestAccess', {}),
    onOpenSettings: () => void call('system.openUrl', { url: PRIVACY_URL }),
    onJoin: (event: AgendaEvent) => event.meetingUrl && void call('system.openUrl', { url: event.meetingUrl }),
  }
}

/** Wraps the view without a box of its own; `empty` tells the island this tab has nothing to show, so it opens elsewhere. */
const Marked = ({ empty, children }: { empty: boolean; children: ReactNode }) => (
  <div data-island-empty={empty ? '' : undefined} style={{ display: 'contents' }}>
    {children}
  </div>
)

/**
 * The tab's one view, with or without an event soon: the agenda already sets the next event as its hero (how soon,
 * Join), so the activity opens this same view instead of a layout of its own.
 */
function Widget() {
  const calendar = useTopic('calendar')
  const [allDay] = useStorage(ALL_DAY, false)
  const events = (calendar?.upcoming ?? []).filter((e) => allDay || !e.allDay).map(toEvent)
  const actions = useActions()
  const empty = calendar?.access !== 'granted' || !events.some((e) => !e.allDay && e.end > Date.now())
  return (
    <Marked empty={empty}>
      <Agenda layout={useSheet()} events={events} access={calendar?.access} {...actions} />
    </Marked>
  )
}

const SECOND = 1000

/** Time to the event's start, re-read on each `unit`'s edge until it starts. */
function useLeft(event: AgendaEvent, unit: number) {
  return event.start - useEdgeClock(event.start, Date.now() < event.start + SECOND, unit)
}

/** The compact left wing: one mark, the calendar's color as a dot. */
function Leading() {
  const event = next.use()
  if (!event) return null
  return <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: event.color }} />
}

/** The compact right wing: the time to go alone (`8m`, then `45s`, as the flash counts), the color already on the left. */
function Trailing() {
  const event = next.use()
  return event ? <TrailingFigure event={event} /> : null
}

function TrailingFigure({ event }: { event: AgendaEvent }) {
  const left = useLeft(event, MINUTE)
  return <span className="text-caption weight-semibold text-foreground tabular-nums">{left > 0 ? formatShort(left / SECOND) : 'now'}</span>
}

/** The split bubble: a ring in the calendar's color that empties as the start nears, with the minutes to go inside. */
function Minimal() {
  const event = next.use()
  return event ? <Ring event={event} /> : null
}

const R = 9
const RING = 2 * Math.PI * R

function Ring({ event }: { event: AgendaEvent }) {
  const [lead] = useStorage(LEAD, 10)
  const left = Math.max(0, useLeft(event, SECOND))
  const figure = ringFigure(left)
  return (
    <svg role="img" aria-label={`${event.title}, in ${formatShort(left / SECOND)}`} viewBox="0 0 22 22" width={24} height={24}>
      <circle cx="11" cy="11" r={R} fill="none" strokeWidth="2" stroke="currentColor" opacity={0.2} />
      <circle
        cx="11"
        cy="11"
        r={R}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={RING}
        strokeDashoffset={RING * (1 - Math.min(1, left / (lead * MINUTE)))}
        transform="rotate(-90 11 11)"
        style={{ stroke: event.color }}
      />
      <text x="11" y="11" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontSize={figure === 'now' ? 6 : 9} fontWeight={600}>
        {figure}
      </text>
    </svg>
  )
}

function Starting() {
  const event = next.use()
  const { onJoin } = useActions()
  return event ? <Agenda.Starting event={event} onJoin={onJoin} /> : null
}

function Settings() {
  const [lead, setLead] = useStorage(LEAD, 10)
  const [alert, setAlert] = useStorage(ALERT, true)
  const [allDay, setAllDay] = useStorage(ALL_DAY, false)
  return (
    <List>
      <List.Section title="Up next">
        <SelectRow
          label="Show the countdown"
          description="The next event takes the wings this long before it starts."
          options={[5, 10, 15, 30].map((m) => ({ value: String(m), label: `${m} min before` }))}
          value={String(lead)}
          onValueChange={(v) => setLead(Number(v))}
        />
      </List.Section>
      <List.Section title="Alerts">
        <SwitchRow
          label="Alert a minute before"
          description="Drops the island open with the event and Join when it has a call link."
          checked={alert}
          onCheckedChange={setAlert}
        />
        <SwitchRow
          label="Include all-day events"
          description="Off, they stay out of the agenda and never alert."
          checked={allDay}
          onCheckedChange={setAllDay}
        />
      </List.Section>
    </List>
  )
}

function activate(ctx: PluginContext) {
  let events: CalendarEvent[] = []
  let settings = { lead: 10, alert: true }
  let shown = false
  const alerted = new Set<string>()

  const tick = () => {
    const now = Date.now()
    const event = events.find((e) => !e.allDay && e.start - settings.lead * MINUTE <= now && now < e.start + AFTER_START_MS)
    const prev = next.get()
    next.set(event ? (prev?.id === event.id && prev.start === event.start ? prev : toEvent(event)) : undefined)
    if (event && !shown) ctx.activity.show({ priority: 'calendar', compact: { leading: Leading, trailing: Trailing }, minimal: Minimal, expanded: Widget })
    if (!event && shown) ctx.activity.hide()
    shown = !!event

    const key = event && `${event.id}@${event.start}`
    if (event && key && settings.alert && !alerted.has(key) && event.start - now <= ALERT_MS && now < event.start) {
      alerted.add(key)
      ctx.activity.flash({ priority: 'alert', key: 'starting', view: Starting, durationMs: 8000 })
    }
  }

  const readSettings = async () => {
    settings = { lead: (await ctx.storage.get<number>(LEAD)) ?? 10, alert: (await ctx.storage.get<boolean>(ALERT)) ?? true }
    tick()
  }

  const stops = [
    ctx.subscribe('calendar', (state) => {
      events = state.access === 'granted' ? state.upcoming : []
      tick()
    }),
    ctx.storage.subscribe(LEAD, readSettings),
    ctx.storage.subscribe(ALERT, readSettings),
  ]
  void readSettings()
  const timer = setInterval(tick, 15_000)

  return () => {
    clearInterval(timer)
    for (const stop of stops) stop()
    if (shown) ctx.activity.hide()
  }
}

export default definePlugin({
  activate,
  widget: { title: 'Calendar', icon: CalendarDays, view: Widget },
  settings: Settings,
})
