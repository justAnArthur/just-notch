import { Button, List } from '@justanarthur/modo-ui'
import { Countdown, IslandFlash, Widget, WidgetFigure, WidgetHeader, WidgetSubtitle } from '@justanarthur/modo-ui-notch'
import { definePlugin, type PluginContext, type PowerState, SelectRow, signal, type SearchItem, SwitchRow, useStorage } from '@just-notch/sdk'
import { Coffee, Moon } from 'lucide-react'
import { describe, extend, type Hold, holdFor, parseDuration, PRESETS, shouldEnd } from './logic'

const HOLD = 'hold'
const DISPLAY = 'display'
const LOW_BATTERY = 'lowBattery'
const DEFAULT_MINUTES = 'defaultMinutes'
const UNTIL_OFF = 'off'

/** The running hold, for the views. */
const current = signal<Hold | null>(null)

const reason = (hold: Hold) => (hold.display ? 'Just Notch: Stay Awake (display on)' : 'Just Notch: Stay Awake')

function Remaining({ hold, format }: { hold: Hold; format: 'short' | 'clock' }) {
  return hold.endsAt === undefined ? <>On</> : <Countdown endsAt={hold.endsAt} format={format} />
}

function Leading() {
  return <Coffee size={16} strokeWidth={1.75} />
}

function Trailing() {
  const hold = current.use()
  return hold ? (
    <span className="text-xs tabular-nums">
      <Remaining hold={hold} format="short" />
    </span>
  ) : null
}

function Minimal() {
  return <Coffee size={14} strokeWidth={1.75} />
}

function Expanded() {
  const hold = current.use()
  const [, setHold] = useStorage<Hold | null>(HOLD, null)
  if (!hold) return null
  return (
    <Widget>
      <WidgetHeader icon={Coffee}>Staying awake</WidgetHeader>
      <WidgetFigure value={<Remaining hold={hold} format="clock" />} unit={hold.endsAt === undefined ? undefined : 'left'} />
      <WidgetSubtitle>{hold.display ? 'The Mac and its display stay on' : 'The Mac stays on; the display may sleep'}</WidgetSubtitle>
      <div className="mt-2 flex gap-2">
        {hold.endsAt !== undefined && (
          <Button variant="secondary" size="compact" onClick={() => setHold(extend(hold, 30))}>
            +30 min
          </Button>
        )}
        <Button variant="secondary" size="compact" onClick={() => setHold(null)}>
          Let it sleep
        </Button>
      </div>
    </Widget>
  )
}

function ended(why: 'time' | 'battery') {
  return function Ended() {
    return (
      <IslandFlash
        tone={why === 'battery' ? 'warning' : 'default'}
        icon={<Moon size={20} strokeWidth={1.75} />}
        title="Your Mac can sleep again"
        caption={why === 'battery' ? 'The battery is low' : 'Stay Awake is over'}
      />
    )
  }
}

async function read<T>(ctx: PluginContext, key: string, fallback: T): Promise<T> {
  return (await ctx.storage.get<T>(key)) ?? fallback
}

async function start(ctx: PluginContext, minutes?: number | typeof UNTIL_OFF) {
  const chosen = minutes ?? (await read<number | typeof UNTIL_OFF>(ctx, DEFAULT_MINUTES, 60))
  await ctx.storage.set(HOLD, holdFor(chosen === UNTIL_OFF ? undefined : chosen, await read(ctx, DISPLAY, false)))
}

function activate(ctx: PluginContext) {
  let hold: Hold | null = null
  let power: PowerState | undefined
  let lowBattery: number | null = 20
  let timer: ReturnType<typeof setTimeout> | undefined
  let shown = false

  const end = async (why: 'time' | 'battery') => {
    await ctx.storage.set(HOLD, null)
    ctx.activity.flash({ priority: 'alert', key: 'awake', view: ended(why), durationMs: 3000 })
  }

  const check = () => {
    if (!hold) return
    const why = shouldEnd(hold, Date.now(), power, lowBattery)
    if (why) void end(why)
  }

  const follow = (next: Hold | null | undefined) => {
    hold = next ?? null
    current.set(hold)
    clearTimeout(timer)
    if (hold) {
      void ctx.call('power.stayAwake', { display: hold.display, reason: reason(hold) }).catch(() => {})
      if (!shown) ctx.activity.show({ priority: 'ambient', title: 'Stay Awake', compact: { leading: Leading, trailing: Trailing }, minimal: Minimal, expanded: Expanded })
      if (hold.endsAt !== undefined) timer = setTimeout(check, Math.max(0, hold.endsAt - Date.now()) + 50)
      if (hold.endsAt !== undefined && Date.now() >= hold.endsAt) check()
    } else {
      void ctx.call('power.allowSleep', {}).catch(() => {})
      if (shown) ctx.activity.hide()
    }
    shown = !!hold
  }

  const stops = [
    ctx.storage.subscribe<Hold | null>(HOLD, follow),
    ctx.storage.subscribe<boolean>(LOW_BATTERY, (on) => (lowBattery = on === false ? null : 20)),
    ctx.subscribe('power', (next) => {
      power = next
      check()
    }),
  ]
  void ctx.storage.get<boolean>(LOW_BATTERY).then((on) => (lowBattery = on === false ? null : 20))
  void ctx.storage.get<Hold | null>(HOLD).then(follow)
  // Timers stall while the Mac idles: a short tick ends the hold close to its time.
  const tick = setInterval(check, 15_000)

  return () => {
    for (const stop of stops) stop()
    clearTimeout(timer)
    clearInterval(tick)
    void ctx.call('power.allowSleep', {}).catch(() => {})
    if (shown) ctx.activity.hide()
  }
}

const durationOptions = PRESETS.map((m) => ({ value: m === undefined ? UNTIL_OFF : String(m), label: m === undefined ? 'Until I turn it off' : describe(m) }))

function Settings() {
  const [display, setDisplay] = useStorage(DISPLAY, false)
  const [low, setLow] = useStorage(LOW_BATTERY, true)
  const [minutes, setMinutes] = useStorage<number | typeof UNTIL_OFF>(DEFAULT_MINUTES, 60)
  const [hold, setHold] = useStorage<Hold | null>(HOLD, null)
  return (
    <List>
      <List.Section title="Stay Awake">
      <SelectRow
        label="Stay awake for"
        description="What “Stay Awake” in the launcher starts with. Type a time after it for another one: “awake 45m”."
        options={durationOptions}
        value={String(minutes)}
        onValueChange={(v) => setMinutes(v === UNTIL_OFF ? UNTIL_OFF : Number(v))}
      />
      <SwitchRow label="Keep the display on" description="For a talk or a dashboard. Off, only the Mac stays awake (a download, a render) and the screen may sleep." checked={display} onCheckedChange={setDisplay} />
      <SwitchRow label="Stop at 20 % battery" description="On battery, the Mac may sleep again once it gets low." checked={low} onCheckedChange={setLow} />
      {hold && (
        <SwitchRow label="Staying awake now" description={hold.endsAt === undefined ? 'Until you turn it off.' : `Until ${new Date(hold.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`} checked onCheckedChange={() => setHold(null)} />
      )}
      </List.Section>
    </List>
  )
}

const WORDS = /^(?:stay\s*awake|awake|keep\s*awake|caff(?:einate)?|coffee|no\s*sleep|amphetamine)\b\s*(.*)$/i

function search(query: string, ctx: PluginContext, root: boolean): SearchItem[] {
  const q = query.trim()
  const words = WORDS.exec(q)
  // In the root search only its own words reach it; inside its scope everything typed is a duration.
  if (root && !words) return []
  const rest = (words ? words[1] : q) ?? ''
  const typed = rest ? parseDuration(rest) : null
  const items: SearchItem[] = []
  const hold = current.get()

  if (hold) {
    items.push({
      id: 'stop',
      title: 'Let the Mac sleep',
      subtitle: 'Stay Awake',
      icon: Moon,
      actions: [{ title: 'Stop', run: () => ctx.storage.set(HOLD, null) }],
    })
    if (hold.endsAt !== undefined) {
      items.push({ id: 'extend', title: 'Stay awake 30 min longer', subtitle: 'Stay Awake', icon: Coffee, actions: [{ title: 'Extend', run: () => ctx.storage.set(HOLD, extend(hold, 30)) }] })
    }
  }
  const offer = (minutes: number | undefined) => ({
    id: `for-${minutes ?? UNTIL_OFF}`,
    title: minutes === undefined ? 'Stay awake until I turn it off' : `Stay awake for ${describe(minutes)}`,
    subtitle: 'Stay Awake',
    icon: Coffee,
    actions: [{ title: 'Start', run: () => start(ctx, minutes ?? UNTIL_OFF) }],
  })
  if (typed) items.push(offer(typed))
  else if (!rest) items.push(...PRESETS.map(offer))
  return items
}

export default definePlugin({
  activate,
  settings: Settings,
  search: {
    title: 'Stay Awake',
    icon: Coffee,
    keywords: ['awake', 'caffeinate'],
    root: { limit: 3 },
    provide: (query, { ctx, root }) => search(query, ctx, root),
  },
})
