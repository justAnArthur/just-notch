import { describe, expect, it } from 'bun:test'
import type { PowerState } from '@just-notch/sdk'
import { describe as say, extend, holdFor, MINUTE, parseDuration, shouldEnd } from '../src/logic'

describe('durations', () => {
  it('reads what people type', () => {
    expect(parseDuration('45')).toBe(45)
    expect(parseDuration('45m')).toBe(45)
    expect(parseDuration('90 min')).toBe(90)
    expect(parseDuration('1h')).toBe(60)
    expect(parseDuration('1.5h')).toBe(90)
    expect(parseDuration('1,5 h')).toBe(90)
    expect(parseDuration('2 hours')).toBe(120)
    expect(parseDuration('1h30')).toBe(90)
    expect(parseDuration('1h 30m')).toBe(90)
  })

  it('rejects the rest and caps at a day', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('off')).toBeNull()
    expect(parseDuration('0')).toBeNull()
    expect(parseDuration('48h')).toBe(24 * 60)
  })

  it('says them in words', () => {
    expect(say(30)).toBe('30 min')
    expect(say(60)).toBe('1 hour')
    expect(say(90)).toBe('1 h 30 min')
    expect(say(120)).toBe('2 hours')
    expect(say(undefined)).toBe('until you turn it off')
  })
})

const power = (percent: number, pluggedIn = false): PowerState => ({ percent, charging: pluggedIn, pluggedIn, lowPowerMode: false, hasBattery: true })

describe('ending', () => {
  const hold = holdFor(30, false, 0)

  it('ends when its time is up', () => {
    expect(shouldEnd(hold, 29 * MINUTE, power(80), 20)).toBeNull()
    expect(shouldEnd(hold, 30 * MINUTE, power(80), 20)).toBe('time')
    expect(shouldEnd(holdFor(undefined, false, 0), 1e12, power(80), 20)).toBeNull()
  })

  it('lets the Mac sleep when the battery gets low, only on battery', () => {
    expect(shouldEnd(hold, 0, power(20), 20)).toBe('battery')
    expect(shouldEnd(hold, 0, power(15, true), 20)).toBeNull()
    expect(shouldEnd(hold, 0, power(15), null)).toBeNull()
    expect(shouldEnd(hold, 0, undefined, 20)).toBeNull()
  })

  it('extends from the end, or from now once it ran out', () => {
    expect(extend(hold, 30, 0).endsAt).toBe(60 * MINUTE)
    expect(extend(hold, 30, 45 * MINUTE).endsAt).toBe(75 * MINUTE)
    expect(extend(holdFor(undefined, true, 0), 30, 0).endsAt).toBeUndefined()
  })
})
