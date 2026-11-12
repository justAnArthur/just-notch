import { Button, Slider, Switch, SwitchGroup } from '@justanarthur/modo-ui'
import { definePlugin, type Events, type PluginContext, usePlugin, useStorage, useTopic } from '@just-notch/sdk'
import {
  Keyboard,
  KeyboardOff,
  type LucideIcon,
  Speaker,
  Sun,
  SunDim,
  SunMedium,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'

type Hud = Events['hud']
type Kind = Hud['kind']

const FLASH_MS = 1500
const ACCESSIBILITY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

/** The level the flash shows; the host's key events and the slider both write it. */
let level: Hud = { kind: 'volume', value: 0 }
/** The host publishes no brightness, so the last one a key or the slider set is the best known. */
let brightness = 0.5
const listeners = new Set<() => void>()
const subscribeLevel = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function setLevel(next: Hud) {
  level = next
  if (next.kind === 'brightness') brightness = next.value
  for (const cb of [...listeners]) cb()
}
const useLevel = () => useSyncExternalStore(subscribeLevel, () => level)
const useBrightness = () => useSyncExternalStore(subscribeLevel, () => brightness)

function glyph({ kind, value, muted }: Hud): LucideIcon {
  if (kind === 'volume') {
    if (muted || value === 0) return VolumeX
    return value < 0.34 ? Volume : value < 0.67 ? Volume1 : Volume2
  }
  if (kind === 'brightness') return value < 0.34 ? SunDim : value < 0.67 ? SunMedium : Sun
  return value === 0 ? KeyboardOff : Keyboard
}

const LABEL: Record<Kind, string> = { volume: 'Volume', brightness: 'Brightness', keyboard: 'Keyboard brightness' }
const percent = (v: number) => Math.round(v * 100)

/** Sets a level from a slider: volume and display brightness have host methods; the keyboard backlight has none. */
function useSetLevel() {
  const { call } = usePlugin()
  return (kind: Kind, value: number) => {
    if (kind === 'volume') void call('audio.setVolume', { volume: value })
    if (kind === 'brightness') void call('display.setBrightness', { brightness: value })
  }
}

function Level({ hud, onChange }: { hud: Hud; onChange?: (value: number) => void }) {
  const Icon = glyph(hud)
  const value = hud.muted ? 0 : hud.value
  return (
    <div className="flex h-9 items-center gap-3">
      <Icon size={16} strokeWidth={1.5} className="shrink-0 text-foreground" />
      <Slider
        className="min-w-0 flex-1"
        size="compact"
        label={LABEL[hud.kind]}
        showValue={false}
        trackClassName="bg-surface-3"
        fillClassName="bg-foreground"
        value={percent(value)}
        disabled={!onChange}
        onChange={(v) => onChange?.((v as number) / 100)}
      />
      <span className="w-7 shrink-0 text-right text-caption text-muted-foreground tabular-nums">{percent(value)}</span>
    </div>
  )
}

let flashAgain: (kind: Kind) => void = () => {}

function Flash() {
  const hud = useLevel()
  const set = useSetLevel()
  const change = (value: number) => {
    set(hud.kind, value)
    setLevel({ kind: hud.kind, value, muted: false })
    flashAgain(hud.kind)
  }
  return <Level hud={hud} onChange={hud.kind === 'keyboard' ? undefined : change} />
}

function Controls() {
  const audio = useTopic('audio')
  const brightness = useBrightness()
  const set = useSetLevel()
  if (!audio) return null
  return (
    <div className="flex size-full flex-col justify-center gap-1">
      <Level hud={{ kind: 'volume', value: audio.volume, muted: audio.muted }} onChange={(v) => set('volume', v)} />
      <Level
        hud={{ kind: 'brightness', value: brightness }}
        onChange={(v) => {
          set('brightness', v)
          setLevel({ kind: 'brightness', value: v })
        }}
      />
      <div className="flex h-9 items-center gap-3">
        <Speaker size={16} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-body text-muted-foreground">{audio.outputDevice}</span>
      </div>
    </div>
  )
}

function Settings() {
  const { call } = usePlugin()
  const [enabled, setEnabled] = useStorage('replaceHud', false)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!enabled) return setBlocked(false)
    void call('permissions.status', { permission: 'accessibility' }).then(({ granted }) => setBlocked(!granted))
  }, [call, enabled])

  const toggle = async (next: boolean) => {
    setEnabled(next)
    const result = await call('hud.setEnabled', { enabled: next })
    if (next && !result.enabled) setBlocked(true)
  }

  return (
    <div className="flex flex-col gap-4">
      <SwitchGroup>
        <Switch
          label="Replace system volume & brightness HUD"
          description="Volume, brightness and keyboard backlight keys show their level in the island."
          checked={enabled}
          onCheckedChange={(next) => void toggle(next)}
        />
      </SwitchGroup>
      {blocked && (
        <div className="flex items-center justify-between gap-4 rounded-xl bg-status-warning/16 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-body weight-medium text-status-warning">Needs Accessibility</span>
            <span className="text-caption text-muted-foreground">
              Allow Just Notch under Privacy & Security › Accessibility so it can take over the keys.
            </span>
          </div>
          <Button className="shrink-0" variant="secondary" size="compact" onClick={() => void call('system.openUrl', { url: ACCESSIBILITY_URL })}>
            Open Settings
          </Button>
        </div>
      )}
    </div>
  )
}

function activate(ctx: PluginContext) {
  let enabled = false
  flashAgain = (kind) => ctx.activity.flash({ priority: 'hud', key: kind, view: Flash, durationMs: FLASH_MS })
  void ctx.storage.get<boolean>('replaceHud').then((stored) => {
    enabled = stored === true
    if (enabled) void ctx.call('hud.setEnabled', { enabled: true })
  })
  const stop = ctx.on('hud', (hud) => {
    setLevel(hud)
    flashAgain(hud.kind)
  })
  return () => {
    stop()
    flashAgain = () => {}
    if (enabled) void ctx.call('hud.setEnabled', { enabled: false })
  }
}

export default definePlugin({
  activate,
  widget: { title: 'Controls', view: Controls },
  settings: Settings,
})
