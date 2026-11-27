import type { PowerState } from '@just-notch/sdk'

/** The plugin's hold, kept in storage so it survives a reload. `endsAt` undefined: until turned off. */
export interface Hold {
  startedAt: number
  endsAt?: number
  /** Keep the display on too (a talk, a dashboard), not just the system (a download). */
  display: boolean
}

export const MINUTE = 60_000

/** The durations offered, in minutes; `undefined` is "until I turn it off". */
export const PRESETS: (number | undefined)[] = [30, 60, 120, undefined]

/**
 * A duration typed in the launcher: `45`, `45m`, `1h`, `1.5h`, `1h30`, `2 hours`, `90 min`. Minutes, or null when it
 * isn't one. Capped at a day.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, '.')
  const hm = /^(\d+)\s*h(?:ours?|rs?)?\s*(\d+)\s*(?:m(?:in(?:utes?)?)?)?$/.exec(t)
  if (hm) return clamp(Number(hm[1]) * 60 + Number(hm[2]))
  const m = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?$/.exec(t)
  if (!m) return null
  const value = Number(m[1])
  const unit = m[2] ?? 'm'
  return clamp(unit.startsWith('h') ? value * 60 : value)
}

const clamp = (minutes: number) => (minutes > 0 ? Math.min(Math.round(minutes), 24 * 60) : null)

/** `30 min`, `1 hour`, `1 h 30 min`, `until you turn it off`. */
export function describe(minutes: number | undefined): string {
  if (minutes === undefined) return 'until you turn it off'
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : h === 1 ? '1 hour' : `${h} hours`
}

/** Why the hold ends now, if it does: its time is up, or the battery fell to `lowBattery` % on battery. */
export function shouldEnd(hold: Hold, now: number, power: PowerState | undefined, lowBattery: number | null): 'time' | 'battery' | null {
  if (hold.endsAt !== undefined && now >= hold.endsAt) return 'time'
  const onBattery = power?.hasBattery && !power.pluggedIn && !power.charging
  if (lowBattery !== null && onBattery && power!.percent <= lowBattery) return 'battery'
  return null
}

/** A hold for `minutes` from `now`, or until turned off. */
export const holdFor = (minutes: number | undefined, display: boolean, now = Date.now()): Hold => ({
  startedAt: now,
  endsAt: minutes === undefined ? undefined : now + minutes * MINUTE,
  display,
})

/** The same hold, `minutes` longer (from now when it has already run out). */
export const extend = (hold: Hold, minutes: number, now = Date.now()): Hold => ({
  ...hold,
  endsAt: hold.endsAt === undefined ? undefined : Math.max(hold.endsAt, now) + minutes * MINUTE,
})
