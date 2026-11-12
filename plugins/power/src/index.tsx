import { Switch, SwitchGroup, spring } from '@justanarthur/modo-ui'
import { definePlugin, type PluginContext, type PowerState, useStorage, useTopic } from '@just-notch/sdk'
import { BatteryLow, Unplug, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import type { ComponentType, ReactNode } from 'react'

type Tone = 'success' | 'warning' | 'error' | 'neutral'
type Alert = 'charging' | 'unplugged' | 'low' | 'critical'

const FILL: Record<Tone, string> = {
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  neutral: 'bg-foreground',
}
const TEXT: Record<Tone, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  neutral: 'text-foreground',
}

const ALERTS: { id: Alert; label: string; description: string }[] = [
  { id: 'charging', label: 'Charging', description: 'When you plug in a charger.' },
  { id: 'unplugged', label: 'On battery', description: 'When you unplug the charger.' },
  { id: 'low', label: 'Low battery', description: 'Once when the battery drops to 20%.' },
  { id: 'critical', label: 'Critically low battery', description: 'Once when the battery drops to 10%.' },
]
const THRESHOLD: Record<'low' | 'critical', number> = { low: 20, critical: 10 }

let shownPercent = 0

/** A battery that fills from empty to its level as the flash opens. */
function Battery({ percent, tone }: { percent: number; tone: Tone }) {
  return (
    <div className="flex items-center gap-px" aria-hidden>
      <div className="relative h-3.5 w-7 overflow-hidden rounded-box bg-active p-0.5">
        <motion.div
          className={`h-full w-full origin-left rounded-glyph ${FILL[tone]}`}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: Math.max(0.06, percent / 100) }}
          transition={spring.slow}
        />
      </div>
      <div className="h-1.5 w-0.5 rounded-r-full bg-active" />
    </div>
  )
}

function Row({ icon, label, detail, tone }: { icon: ReactNode; label: string; detail?: string; tone: Tone }) {
  const percent = useTopic('power')?.percent ?? shownPercent
  return (
    <div className="flex items-center gap-3">
      <span className={`flex size-8 shrink-0 items-center justify-center ${TEXT[tone]}`}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body weight-semibold text-foreground">{label}</span>
        {detail && <span className="truncate text-caption text-muted-foreground">{detail}</span>}
      </div>
      <span className={`text-subtitle weight-semibold tabular-nums ${TEXT[tone]}`}>{Math.round(percent)}%</span>
      <Battery percent={percent} tone={tone} />
    </div>
  )
}

const remaining = (power: PowerState | undefined, verb: string) => {
  const m = power?.minutesRemaining
  if (m === undefined) return undefined
  return `${m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`} ${verb}`
}

function Charging() {
  const power = useTopic('power')
  return <Row icon={<Zap size={18} strokeWidth={1.5} fill="currentColor" />} label="Charging" detail={remaining(power, 'until full')} tone="success" />
}

function Unplugged() {
  const power = useTopic('power')
  return <Row icon={<Unplug size={18} strokeWidth={1.5} />} label="On battery" detail={remaining(power, 'remaining')} tone="neutral" />
}

function Low() {
  return <Row icon={<BatteryLow size={18} strokeWidth={1.5} />} label="Low battery" detail="Plug in soon" tone="warning" />
}

function Critical() {
  return <Row icon={<BatteryLow size={18} strokeWidth={1.5} />} label="Battery critically low" detail="Plug in now" tone="error" />
}

function Settings() {
  return (
    <SwitchGroup>
      {ALERTS.map((alert) => (
        <AlertSwitch key={alert.id} {...alert} />
      ))}
    </SwitchGroup>
  )
}

function AlertSwitch({ id, label, description }: (typeof ALERTS)[number]) {
  const [on, setOn] = useStorage(`alert.${id}`, true)
  return <Switch label={label} description={description} checked={on} onCheckedChange={setOn} />
}

function activate(ctx: PluginContext) {
  const enabled = async (alert: Alert) => (await ctx.storage.get<boolean>(`alert.${alert}`)) ?? true
  const flash = async (alert: Alert, view: ComponentType, durationMs: number) => {
    if (await enabled(alert)) ctx.activity.flash({ priority: 'alert', key: 'power', view, durationMs })
  }

  // A threshold is armed above its level and fires once on the way down, never while charging.
  const armed = { low: false, critical: false }

  const stopPower = ctx.subscribe('power', (power) => {
    shownPercent = power.percent
    if (!power.hasBattery) return
    const discharging = !power.charging && !power.pluggedIn
    const crossed = (['critical', 'low'] as const).find((t) => armed[t] && discharging && power.percent <= THRESHOLD[t])
    for (const t of ['low', 'critical'] as const) armed[t] = !discharging || power.percent > THRESHOLD[t]
    if (crossed === 'critical') void flash('critical', Critical, 4000)
    if (crossed === 'low') void flash('low', Low, 3000)
  })

  const stopPlug = ctx.on('power.plugged', ({ pluggedIn }) => {
    if (pluggedIn) void flash('charging', Charging, 3000)
    else void flash('unplugged', Unplugged, 1600)
  })

  return () => {
    stopPower()
    stopPlug()
  }
}

export default definePlugin({ activate, settings: Settings })
