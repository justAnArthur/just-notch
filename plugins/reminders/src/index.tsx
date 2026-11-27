import { Button, List } from '@justanarthur/modo-ui'
import { IslandFlash, Widget, WidgetHeader, WidgetRow } from '@justanarthur/modo-ui-notch'
import { definePlugin, type PluginContext, type Reminder, type RemindersState, signal, usePlugin, useTopic } from '@just-notch/sdk'
import { Bell, BellRing } from 'lucide-react'
import { describeDue, parseReminder } from './logic'

/** Reminders that are due now, for the views. */
const dueNow = signal<Reminder[]>([])
let context: PluginContext | undefined

function complete(id: string) {
  context?.activity.dismiss(`due-${id}`)
  void context?.call('reminders.complete', { id }).catch(() => {})
}

function snooze(id: string, minutes: number) {
  context?.activity.dismiss(`due-${id}`)
  void context?.call('reminders.snooze', { id, minutes }).catch(() => {})
}

function Leading() {
  return <BellRing size={15} strokeWidth={1.75} />
}

function Trailing() {
  const due = dueNow.use()
  return due.length > 1 ? <span className="text-xs tabular-nums">{due.length}</span> : null
}

function Minimal() {
  return <Bell size={13} strokeWidth={1.75} />
}

function Actions({ reminder }: { reminder: Reminder }) {
  return (
    <span className="flex gap-1">
      <Button variant="ghost" size="compact" onClick={() => snooze(reminder.id, 10)}>
        10 min
      </Button>
      <Button variant="ghost" size="compact" onClick={() => snooze(reminder.id, 60)}>
        1 h
      </Button>
      <Button variant="secondary" size="compact" onClick={() => complete(reminder.id)}>
        Done
      </Button>
    </span>
  )
}

function Expanded() {
  const due = dueNow.use()
  return (
    <Widget>
      <WidgetHeader icon={BellRing}>{due.length === 1 ? 'Reminder' : `${due.length} reminders`}</WidgetHeader>
      {due.map((r) => (
        <WidgetRow key={r.id} color={r.listColor} leading={new Date(r.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} trailing={<Actions reminder={r} />}>
          {r.title}
        </WidgetRow>
      ))}
    </Widget>
  )
}

function dueFlash(reminder: Reminder) {
  return function DueFlash() {
    return (
      <IslandFlash
        tone="info"
        icon={<BellRing size={20} strokeWidth={1.75} />}
        title={reminder.title}
        caption={reminder.list}
        action={
          <Button variant="secondary" size="compact" onClick={() => complete(reminder.id)}>
            Done
          </Button>
        }
      />
    )
  }
}

function activate(ctx: PluginContext) {
  context = ctx
  let state: RemindersState | undefined
  let shown = false
  let shownKey = ''
  /** The due time each reminder was announced for: a snoozed one is announced again when it comes due. */
  const announced = new Map<string, number>()

  const sync = () => {
    const now = Date.now()
    const due = (state?.due ?? []).filter((r) => r.due <= now)
    // The same reminders keep the same array, so the views don't re-render on every tick.
    const key = due.map((r) => `${r.id}@${r.due}:${r.title}`).join('|')
    if (key !== shownKey) dueNow.set(due)
    shownKey = key
    for (const r of due) {
      if (announced.get(r.id) === r.due) continue
      announced.set(r.id, r.due)
      // A reminder that was already overdue when the app started is shown, not flashed.
      if (now - r.due < 10 * 60_000) ctx.activity.flash({ priority: 'alert', key: `due-${r.id}`, view: dueFlash(r), durationMs: 8000 })
    }
    if (due.length && !shown) ctx.activity.show({ priority: 'timer', title: 'Reminders', compact: { leading: Leading, trailing: Trailing }, minimal: Minimal, expanded: Expanded })
    if (!due.length && shown) ctx.activity.hide()
    shown = due.length > 0
  }

  const stop = ctx.subscribe('reminders', (next) => {
    state = next
    sync()
  })
  const tick = setInterval(sync, 15_000)
  return () => {
    stop()
    clearInterval(tick)
    if (shown) ctx.activity.hide()
    context = undefined
  }
}

function Settings() {
  const { call } = usePlugin()
  const state = useTopic('reminders')
  return (
    <List>
      <List.Section title="Reminders">
        {state?.access === 'granted' ? (
          <List.Row label="Connected to Apple Reminders" description="Due reminders stay beside the notch until you choose Done or snooze them. Add one from the launcher: “remind 5pm call the bank”, “remind in 20m stretch”, “remind tomorrow pay rent”." />
        ) : (
          <List.Row
            label="Allow Reminders"
            description={state?.access === 'denied' ? 'Turn on Just Notch under System Settings › Privacy & Security › Reminders.' : 'Just Notch reads your due reminders and adds the ones you type in the launcher.'}
          >
            <Button
              variant="secondary"
              size="compact"
              onClick={() =>
                state?.access === 'denied'
                  ? void call('system.openUrl', { url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders' })
                  : void call('reminders.requestAccess', {})
              }
            >
              {state?.access === 'denied' ? 'Open…' : 'Allow'}
            </Button>
          </List.Row>
        )}
      </List.Section>
    </List>
  )
}

async function add(ctx: PluginContext, title: string, due: number | undefined) {
  const { granted } = await ctx.call('reminders.requestAccess', {})
  if (!granted) return
  await ctx.call('reminders.add', { title, due })
  ctx.activity.flash({
    priority: 'hud',
    key: 'added',
    durationMs: 2500,
    view: () => <IslandFlash tone="success" icon={<Bell size={20} strokeWidth={1.75} />} title={title} caption={`Reminder ${describeDue(due)}`} />,
  })
}

export default definePlugin({
  activate,
  settings: Settings,
  search: {
    title: 'Reminders',
    icon: Bell,
    keywords: ['remind', 'reminder'],
    root: false,
    provide: (query, { ctx }) => {
      const parsed = parseReminder(query)
      if (!parsed) return []
      return [
        {
          id: 'add',
          title: parsed.title,
          subtitle: `Remind me ${describeDue(parsed.due)}`,
          icon: Bell,
          actions: [{ title: 'Add Reminder', run: () => add(ctx, parsed.title, parsed.due) }],
        },
      ]
    },
  },
})
