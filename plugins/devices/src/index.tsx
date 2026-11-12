import { Button, cn } from '@justanarthur/modo-ui'
import { type BluetoothDevice, definePlugin, usePlugin, useTopic } from '@just-notch/sdk'
import {
  Battery,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Bluetooth,
  Gamepad2,
  Headphones,
  Keyboard,
  type LucideIcon,
  Mouse,
  Speaker,
} from 'lucide-react'
import { useSyncExternalStore } from 'react'

const FLASH_MS = 3000
const SETTINGS_URL = 'x-apple.systempreferences:com.apple.BluetoothSettings'

const KIND: Record<BluetoothDevice['kind'], LucideIcon> = {
  headphones: Headphones,
  keyboard: Keyboard,
  mouse: Mouse,
  speaker: Speaker,
  other: Bluetooth,
}

// Class of Device has no kind for game controllers; their names do.
const GAMEPAD = /controller|gamepad|dualsense|dualshock|xbox|joy-con/i

function kindGlyph(device: BluetoothDevice): LucideIcon {
  if (device.kind === 'other' && GAMEPAD.test(device.name)) return Gamepad2
  return KIND[device.kind]
}

function batteryGlyph(percent: number): LucideIcon {
  if (percent <= 10) return BatteryWarning
  if (percent <= 30) return BatteryLow
  if (percent <= 70) return BatteryMedium
  if (percent <= 95) return BatteryFull
  return Battery
}

/** The device the flash announces. */
let announced: BluetoothDevice | undefined
const listeners = new Set<() => void>()
const subscribeAnnounced = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function announce(device: BluetoothDevice) {
  announced = device
  for (const cb of [...listeners]) cb()
}

function Charge({ percent }: { percent: number }) {
  const Icon = batteryGlyph(percent)
  const low = percent <= 20
  return (
    <span className={cn('flex shrink-0 items-center gap-1.5 text-body tabular-nums', low ? 'text-status-error' : 'text-muted-foreground')}>
      {percent}%
      <Icon size={18} strokeWidth={1.5} />
    </span>
  )
}

function Connected() {
  const device = useSyncExternalStore(subscribeAnnounced, () => announced)
  if (!device) return null
  const Icon = kindGlyph(device)
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-foreground">
        <Icon size={16} strokeWidth={1.5} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body weight-semibold text-foreground">{device.name}</span>
        <span className="text-caption text-muted-foreground">Connected</span>
      </div>
      {device.batteryPercent !== undefined && <Charge percent={device.batteryPercent} />}
    </div>
  )
}

function Device({ device }: { device: BluetoothDevice }) {
  const Icon = kindGlyph(device)
  return (
    <li className="flex h-11 min-w-0 items-center gap-3">
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          device.connected ? 'bg-surface-3 text-foreground' : 'bg-surface-2 text-muted-foreground',
        )}
      >
        <Icon size={16} strokeWidth={1.5} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-body', device.connected ? 'text-foreground' : 'text-muted-foreground')}>{device.name}</span>
        <span className="text-caption text-muted-foreground">{device.connected ? 'Connected' : 'Not connected'}</span>
      </div>
      {device.connected && device.batteryPercent !== undefined && <Charge percent={device.batteryPercent} />}
    </li>
  )
}

function Devices() {
  const devices = useTopic('bluetooth')
  const { call } = usePlugin()
  if (!devices) return null
  if (devices.length === 0)
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 text-center">
        <div className="flex size-10 items-center justify-center rounded-xl bg-surface-3 text-muted-foreground">
          <Bluetooth size={16} strokeWidth={1.5} />
        </div>
        <div className="flex flex-col">
          <span className="text-body weight-medium text-foreground">No Bluetooth devices</span>
          <span className="text-caption text-muted-foreground">Pair headphones, a keyboard or a mouse to see them here.</span>
        </div>
        <Button variant="secondary" size="compact" onClick={() => void call('system.openUrl', { url: SETTINGS_URL })}>
          Open Bluetooth Settings
        </Button>
      </div>
    )
  const sorted = [...devices].sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name))
  return (
    <ul className="grid grid-cols-2 gap-x-8">
      {sorted.map((d) => (
        <Device key={d.id} device={d} />
      ))}
    </ul>
  )
}

export default definePlugin({
  activate(ctx) {
    // The host watches for connections only while the topic has a subscriber; its notifications cost nothing at rest.
    const stopTopic = ctx.subscribe('bluetooth', () => {})
    const stopConnected = ctx.on('bluetooth.connected', (device) => {
      announce(device)
      ctx.activity.flash({ priority: 'alert', key: `device:${device.id}`, view: Connected, durationMs: FLASH_MS })
    })
    return () => {
      stopTopic()
      stopConnected()
    }
  },
  widget: { title: 'Devices', icon: Bluetooth, view: Devices },
})
