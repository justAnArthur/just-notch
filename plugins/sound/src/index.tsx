import { Button, List } from '@justanarthur/modo-ui'
import { IslandFlash } from '@justanarthur/modo-ui-notch'
import { type AudioDevice, type AudioDevices, definePlugin, type PluginContext, type SearchItem, SwitchRow, useStorage } from '@just-notch/sdk'
import { Cable, Headphones, Laptop, type LucideIcon, Mic, MicVocal, Monitor, Speaker } from 'lucide-react'
import { betterMic, matches, merge, type Switched, switched, wording } from './logic'

const SWITCHES = 'flashSwitches'
const MIC_HINT = 'micHint'
/** AirPods move the output and the input a moment apart: one flash for both. */
const SETTLE_MS = 700

const on = async (ctx: PluginContext, key: string) => (await ctx.storage.get<boolean>(key)) ?? true

function glyph(device: AudioDevice, kind: 'output' | 'input'): LucideIcon {
  if (kind === 'input') return device.transport === 'bluetooth' ? Headphones : Mic
  switch (device.transport) {
    case 'builtIn':
      return Laptop
    case 'bluetooth':
      return Headphones
    case 'hdmi':
    case 'displayPort':
      return Monitor
    case 'usb':
      return Cable
    case 'airPlay':
      return Speaker
    default:
      return Speaker
  }
}

function switchFlash(change: Switched) {
  const words = wording(change)!
  const device = change.output ?? change.input!
  const Icon = glyph(device, change.output ? 'output' : 'input')
  return function SwitchFlash() {
    return <IslandFlash icon={<Icon size={20} strokeWidth={1.75} />} title={words.title} caption={words.caption} />
  }
}

function micFlash(ctx: PluginContext, current: AudioDevice, better: AudioDevice) {
  return function MicFlash() {
    return (
      <IslandFlash
        tone="warning"
        icon={<MicVocal size={20} strokeWidth={1.75} />}
        title={`Using ${current.name}${/s$/i.test(current.name) ? '’' : '’s'} mic`}
        caption="Headset mics make calls sound worse"
        action={
          <Button
            variant="secondary"
            size="compact"
            onClick={() => {
              void ctx.call('audio.setDevice', { id: better.id, kind: 'input' })
              ctx.activity.dismiss('mic')
            }}
          >
            Use {better.transport === 'builtIn' ? 'Mac mic' : better.name}
          </Button>
        }
      />
    )
  }
}

/** The latest reading, for the launcher. */
let latest: AudioDevices | undefined

function activate(ctx: PluginContext) {
  let last: AudioDevices | undefined
  let pending: Switched = {}
  let settle: ReturnType<typeof setTimeout> | undefined
  /** The call the mic hint was shown for: once per call. */
  let hinted = false

  const stop = ctx.subscribe('audioDevices', (state) => {
    const change = switched(last, state)
    last = state
    latest = state

    if (change.output || change.input) {
      pending = merge(pending, change)
      clearTimeout(settle)
      settle = setTimeout(() => {
        const burst = pending
        pending = {}
        if (!wording(burst)) return
        void on(ctx, SWITCHES).then((show) => show && ctx.activity.flash({ priority: 'hud', key: 'switch', view: switchFlash(burst), durationMs: 2500 }))
      }, SETTLE_MS)
    }

    if (!state.micInUse) hinted = false
    const better = betterMic(state)
    const input = state.inputs.find((d) => d.id === state.input)
    if (better && input && !hinted) {
      hinted = true
      void on(ctx, MIC_HINT).then((show) => show && ctx.activity.flash({ priority: 'alert', key: 'mic', view: micFlash(ctx, input, better), durationMs: 8000 }))
    }
  })

  return () => {
    stop()
    clearTimeout(settle)
  }
}

function Settings() {
  const [switches, setSwitches] = useStorage(SWITCHES, true)
  const [hint, setHint] = useStorage(MIC_HINT, true)
  return (
    <List>
      <List.Section title="Sound Check">
        <SwitchRow label="When sound moves" description="A short flash when sound or the microphone switches to another device: AirPods connecting, a display with speakers, a USB headset." checked={switches} onCheckedChange={setSwitches} />
        <SwitchRow
          label="Headset mic in calls"
          description="When a call starts on AirPods' or another headset's mic, which makes the call sound worse, offers to use the Mac's microphone instead."
          checked={hint}
          onCheckedChange={setHint}
        />
      </List.Section>
    </List>
  )
}

function search(query: string, ctx: PluginContext, root: boolean): SearchItem[] {
  const devices = latest
  if (!devices) return []
  if (root && !matches(query, [...devices.outputs, ...devices.inputs])) return []
  const q = query.trim().toLowerCase()
  const wantsMic = /\b(mic|microphone|input)/.test(q)
  // Virtual devices (Loom, Zoom, loopback tools) only inside the scope, not in every search.
  const shown = (d: AudioDevice) => !root || d.transport !== 'virtual'
  const named = (d: AudioDevice) => !q || root || d.name.toLowerCase().includes(q) || /^(sound|audio|output|speaker|mic|microphone|input)/.test(q)
  const outputs = wantsMic ? [] : devices.outputs.filter((d) => shown(d) && named(d))
  const inputs = devices.inputs.filter((d) => shown(d) && (wantsMic || named(d)))
  const row = (device: AudioDevice, kind: 'output' | 'input'): SearchItem => {
    const current = (kind === 'output' ? devices.output : devices.input) === device.id
    return {
      id: `${kind}-${device.id}`,
      title: kind === 'output' ? `Play sound through ${device.name}` : `Use the mic of ${device.name}`,
      subtitle: 'Sound Check',
      icon: glyph(device, kind),
      accessory: current ? 'In use' : device.transport === 'bluetooth' ? 'Bluetooth' : undefined,
      actions: [{ title: 'Switch', run: async () => void (await ctx.call('audio.setDevice', { id: device.id, kind })) }],
    }
  }
  return [...outputs.map((d) => row(d, 'output')), ...inputs.map((d) => row(d, 'input'))]
}

export default definePlugin({
  activate,
  settings: Settings,
  search: {
    title: 'Sound',
    icon: Speaker,
    keywords: ['sound', 'audio', 'mic'],
    root: { limit: 3 },
    provide: (query, { ctx, root }) => search(query, ctx, root),
  },
})
