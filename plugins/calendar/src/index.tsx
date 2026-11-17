import { Agenda, type AgendaEvent } from '@justanarthur/modo-ui-notch'
import { List } from '@justanarthur/modo-ui'
import { type CalendarEvent, definePlugin, type PluginContext, SelectRow, signal, SwitchRow, usePlugin, useSheet, useStorage, useTopic } from '@just-notch/sdk'
import { CalendarDays } from 'lucide-react'

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

function Widget() {
  const calendar = useTopic('calendar')
  const [allDay] = useStorage(ALL_DAY, false)
  const events = (calendar?.upcoming ?? []).filter((e) => allDay || !e.allDay).map(toEvent)
  const actions = useActions()
  return <Agenda layout={useSheet()} events={events} access={calendar?.access} {...actions} />
}

function UpNext() {
  const event = next.use()
  const { onJoin } = useActions()
  return event ? <Agenda.UpNext event={event} onJoin={onJoin} /> : null
}

function Leading() {
  const event = next.use()
  return event ? <Agenda.Leading event={event} /> : null
}

function Trailing() {
  const event = next.use()
  return event ? <Agenda.Trailing event={event} /> : null
}

function Minimal() {
  const event = next.use()
  return event ? <Agenda.Minimal event={event} /> : null
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
    if (event && !shown) ctx.activity.show({ priority: 'calendar', compact: { leading: Leading, trailing: Trailing }, minimal: Minimal, expanded: UpNext })
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
