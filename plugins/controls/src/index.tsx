import { Button, List } from '@justanarthur/modo-ui'
import { IslandFlash, Level } from '@justanarthur/modo-ui-notch'
import { definePlugin, type PluginContext, signal, SwitchRow, usePlugin, useStorage, useTopic } from '@just-notch/sdk'
import { BatteryCharging, BatteryLow, BatteryWarning, Keyboard, KeyboardOff, type LucideIcon, Sun, SunDim, SunMedium, Volume, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Armed, crossBattery, formatMinutes, type Hud, type Shade, shade, type Threshold } from './logic'

const LEVEL_MS = 1500
const CHARGING_MS = 3000
const LOW_MS = 4000
/** How often the plugin looks for Accessibility while it lacks it, to take over the keys once it's granted. */
const TRUST_POLL_MS = 3000
const ACCESSIBILITY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

/** The settings switches, all on by default. */
const KEYS = { hud: 'replaceHud', charging: 'flashCharging', low: 'flashLowBattery' } as const
const on = async (ctx: PluginContext, key: string) => (await ctx.storage.get<boolean>(key)) ?? true

const GLYPHS: Record<Hud['kind'], Record<Shade, LucideIcon>> = {
  volume: { off: VolumeX, low: Volume, mid: Volume1, high: Volume2 },
  brightness: { off: SunDim, low: SunDim, mid: SunMedium, high: Sun },
  keyboard: { off: KeyboardOff, low: Keyboard, mid: Keyboard, high: Keyboard },
}
const LABEL: Record<Hud['kind'], string> = { volume: 'Volume', brightness: 'Brightness', keyboard: 'Keyboard brightness' }

/** The level the flash shows, written by each key press. */
const level = signal<Hud>({ kind: 'volume', value: 0 })

function LevelFlash() {
  const hud = level.use()
  return (
    <Level
      icon={GLYPHS[hud.kind][shade(hud)]}
      value={hud.muted ? 0 : hud.value}
      label={LABEL[hud.kind]}
      showValue={hud.muted ? 'Muted' : true}
      className="h-full"
    />
  )
}

/** The battery's figure for the flashes: the topic's latest reading. */
function useBattery() {
  const power = useTopic('power')
  return { percent: Math.round(power?.percent ?? 0), minutes: power?.minutesRemaining }
}

function Charging() {
  const { percent, minutes } = useBattery()
  const left = formatMinutes(minutes)
  return <IslandFlash tone="success" icon={<BatteryCharging size={20} strokeWidth={1.75} />} title="Charging" caption={left && `${left} until full`} value={`${percent}%`} />
}

function lowBattery(threshold: Threshold) {
  const critical = threshold === 10
  return function LowBattery() {
    const { percent, minutes } = useBattery()
    const left = formatMinutes(minutes)
    const Icon = critical ? BatteryWarning : BatteryLow
    return (
      <IslandFlash
        tone={critical ? 'error' : 'warning'}
        icon={<Icon size={20} strokeWidth={1.75} />}
        title={critical ? 'Battery very low' : 'Low battery'}
        caption={[left && `${left} left`, critical ? 'Plug in now' : 'Plug in soon'].filter(Boolean).join(' · ')}
        value={`${percent}%`}
      />
    )
  }
}
const LOW_VIEWS = { 20: lowBattery(20), 10: lowBattery(10) }

/**
 * Takes over the volume and brightness keys while the plugin runs and the switch is on, and gives them back to the
 * system otherwise. Without Accessibility it waits, without prompting, and takes over once it's granted: the prompt
 * comes only from the settings' Allow button.
 */
function replaceHud(ctx: PluginContext) {
  let want = false
  let enabled = false
  let poll: ReturnType<typeof setInterval> | undefined
  const stopPolling = () => {
    clearInterval(poll)
    poll = undefined
  }
  const sync = async () => {
    if (!want) {
      stopPolling()
      if (enabled) enabled = (await ctx.call('hud.setEnabled', { enabled: false })).enabled
      return
    }
    if (enabled) return
    const { granted } = await ctx.call('permissions.status', { permission: 'accessibility' }).catch(() => ({ granted: false }))
    if (granted && want) enabled = (await ctx.call('hud.setEnabled', { enabled: true })).enabled
    if (enabled) stopPolling()
    else poll ??= setInterval(() => void sync(), TRUST_POLL_MS)
  }
  const set = (next: boolean) => {
    want = next
    void sync()
  }
  void on(ctx, KEYS.hud).then(set)
  const stopSwitch = ctx.storage.subscribe<boolean>(KEYS.hud, (value) => set(value ?? true))
  return () => {
    stopSwitch()
    want = false
    void sync()
  }
}

function activate(ctx: PluginContext) {
  const stopReplacing = replaceHud(ctx)

  // One key for every level, so a volume press right after a brightness one replaces it instead of queueing.
  const stopHud = ctx.on('hud', (hud) => {
    level.set(hud)
    ctx.activity.flash({ priority: 'hud', key: 'level', view: LevelFlash, durationMs: LEVEL_MS })
  })

  let armed: Armed | undefined
  const stopPower = ctx.subscribe('power', (power) => {
    const result = crossBattery(armed, power)
    armed = result.armed
    const threshold = result.crossed
    if (threshold === undefined) return
    void on(ctx, KEYS.low).then((show) => show && ctx.activity.flash({ priority: 'alert', key: 'power', view: LOW_VIEWS[threshold], durationMs: LOW_MS }))
  })

  const stopPlug = ctx.on('power.plugged', ({ pluggedIn }) => {
    if (!pluggedIn) return
    void on(ctx, KEYS.charging).then((show) => show && ctx.activity.flash({ priority: 'alert', key: 'power', view: Charging, durationMs: CHARGING_MS }))
  })

  return () => {
    stopReplacing()
    stopHud()
    stopPower()
    stopPlug()
  }
}

function Settings() {
  const { call } = usePlugin()
  const [hud, setHud] = useStorage<boolean>(KEYS.hud, true)
  const [charging, setCharging] = useStorage<boolean>(KEYS.charging, true)
  const [low, setLow] = useStorage<boolean>(KEYS.low, true)
  const [trusted, setTrusted] = useState(true)

  useEffect(() => {
    if (!hud) return
    const check = () => void call('permissions.status', { permission: 'accessibility' }).then(({ granted }) => setTrusted(granted), () => {})
    check()
    const timer = setInterval(check, TRUST_POLL_MS)
    return () => clearInterval(timer)
  }, [call, hud])

  const allow = () => {
    // Asking to take over the keys is what puts Just Notch in the Accessibility list, with the system's own prompt.
    void call('hud.setEnabled', { enabled: true })
    void call('system.openUrl', { url: ACCESSIBILITY_URL })
  }

  return (
    <List>
      <List.Section title="Keys">
        <SwitchRow
          label="Volume and brightness"
          description="The volume, brightness and keyboard light keys show their level under the notch instead of the system's overlay. ⌥⇧ with a key moves in quarter steps."
          checked={hud}
          onCheckedChange={setHud}
        />
        {hud && !trusted && (
          <List.Row label="Needs Accessibility" description="Allow Just Notch under Privacy & Security › Accessibility to take over the keys. Until then the system's overlay shows.">
            <Button variant="secondary" size="compact" onClick={allow}>
              Allow…
            </Button>
          </List.Row>
        )}
      </List.Section>
      <List.Section title="Battery">
        <SwitchRow label="Charging" description="When you plug in: the level and how long until full." checked={charging} onCheckedChange={setCharging} />
        <SwitchRow label="Low battery" description="Once at 20 % and once at 10 %, while on battery." checked={low} onCheckedChange={setLow} />
      </List.Section>
    </List>
  )
}

export default definePlugin({ activate, settings: Settings })
