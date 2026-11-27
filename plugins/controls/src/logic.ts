import type { BluetoothDevice, Events, PowerState } from '@just-notch/sdk'

export type Hud = Events['hud']
export type Shade = 'off' | 'low' | 'mid' | 'high'

/** Which glyph a level takes: off (muted, dark), then thirds. */
export function shade({ value, muted }: Pick<Hud, 'value' | 'muted'>): Shade {
  if (muted || value <= 0) return 'off'
  return value < 1 / 3 ? 'low' : value < 2 / 3 ? 'mid' : 'high'
}

/** The battery levels that warn, highest first; each fires once on the way down. */
export const THRESHOLDS = [20, 10] as const
export type Threshold = (typeof THRESHOLDS)[number]

/** Which thresholds still wait to fire: those the battery is above, or all of them while it charges. */
export type Armed = Record<Threshold, boolean>

/**
 * The threshold `power` has just crossed, and what stays armed. Discharging past 20 % fires 20, past 10 % fires 10
 * (once each, the lower one when a reading skips both); plugging in or rising above a level re-arms it. The first
 * reading only arms: opening the app at 15 % doesn't warn.
 */
export function crossBattery(armed: Armed | undefined, power: PowerState): { crossed?: Threshold; armed: Armed } {
  const discharging = power.hasBattery && !power.charging && !power.pluggedIn
  const next = Object.fromEntries(THRESHOLDS.map((t) => [t, !discharging || power.percent > t])) as Armed
  if (!armed || !discharging) return { armed: next }
  const crossed = [...THRESHOLDS].reverse().find((t) => armed[t] && power.percent <= t)
  return { crossed, armed: next }
}

/** `1 h 20 min`, `35 min`; nothing while the system is still estimating. */
export function formatMinutes(minutes: number | undefined): string | undefined {
  if (minutes === undefined || minutes <= 0) return undefined
  const m = Math.round(minutes)
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`
}

/** Each connected accessory's armed thresholds, by device id. */
export type ArmedDevices = Record<string, Armed>

/**
 * Accessories (AirPods, mouse, keyboard) that just crossed 20 % or 10 %, with the same rules as the Mac's battery:
 * once each on the way down, re-armed when the level rises (it charged) and never on a device's first reading.
 * A disconnected device or one without a level drops out, so it starts over when it comes back.
 */
export function crossDevices(armed: ArmedDevices, devices: BluetoothDevice[]): { crossed: { device: BluetoothDevice; threshold: Threshold }[]; armed: ArmedDevices } {
  const next: ArmedDevices = {}
  const crossed: { device: BluetoothDevice; threshold: Threshold }[] = []
  for (const device of devices) {
    if (!device.connected || device.batteryPercent === undefined) continue
    const percent = device.batteryPercent
    next[device.id] = Object.fromEntries(THRESHOLDS.map((t) => [t, percent > t])) as Armed
    const before = armed[device.id]
    if (!before) continue
    const threshold = [...THRESHOLDS].reverse().find((t) => before[t] && percent <= t)
    if (threshold !== undefined) crossed.push({ device, threshold })
  }
  return { crossed, armed: next }
}

/** Connected accessories at or below `below` %, lowest first: worth charging along with the Mac. */
export function lowDevices(devices: BluetoothDevice[], below = 30): BluetoothDevice[] {
  return devices
    .filter((d) => d.connected && d.batteryPercent !== undefined && d.batteryPercent <= below)
    .sort((a, b) => (a.batteryPercent ?? 0) - (b.batteryPercent ?? 0))
}
