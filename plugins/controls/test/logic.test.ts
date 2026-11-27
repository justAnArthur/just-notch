import { describe, expect, it } from 'bun:test'
import type { PowerState } from '@just-notch/sdk'
import type { BluetoothDevice } from '@just-notch/sdk'
import { type Armed, type ArmedDevices, crossBattery, crossDevices, formatMinutes, lowDevices, shade } from '../src/logic'

const power = (percent: number, plugged = false): PowerState => ({ percent, charging: plugged, pluggedIn: plugged, lowPowerMode: false, hasBattery: true })

/** Feeds readings in order and lists the thresholds that fired. */
function fired(readings: PowerState[]) {
  let armed: Armed | undefined
  const out: number[] = []
  for (const reading of readings) {
    const result = crossBattery(armed, reading)
    armed = result.armed
    if (result.crossed) out.push(result.crossed)
  }
  return out
}

describe('low battery', () => {
  it('warns once at 20 % and once at 10 % on the way down', () => {
    expect(fired([power(25), power(21), power(20), power(19), power(12), power(10), power(9), power(5)])).toEqual([20, 10])
  })

  it('fires the lower one when a reading skips both', () => {
    expect(fired([power(22), power(9)])).toEqual([10])
  })

  it('stays quiet on the first reading, while charging, and without a battery', () => {
    expect(fired([power(15), power(14)])).toEqual([])
    expect(fired([power(25, true), power(15, true)])).toEqual([])
    expect(fired([{ ...power(25), hasBattery: false }, { ...power(5), hasBattery: false }])).toEqual([])
  })

  it('re-arms after charging back above a level', () => {
    expect(fired([power(21), power(19), power(19, true), power(30, true), power(30), power(20)])).toEqual([20, 20])
  })
})

describe('level glyph', () => {
  it('goes off when muted or at zero, then by thirds', () => {
    expect(shade({ value: 0.8, muted: true })).toBe('off')
    expect(shade({ value: 0 })).toBe('off')
    expect(shade({ value: 0.2 })).toBe('low')
    expect(shade({ value: 0.5 })).toBe('mid')
    expect(shade({ value: 1 })).toBe('high')
  })
})

describe('time left', () => {
  it('reads as hours and minutes', () => {
    expect(formatMinutes(80)).toBe('1 h 20 min')
    expect(formatMinutes(120)).toBe('2 h')
    expect(formatMinutes(35)).toBe('35 min')
    expect(formatMinutes(undefined)).toBeUndefined()
  })
})

const pods = (batteryPercent?: number, connected = true): BluetoothDevice => ({ id: 'pods', name: 'AirPods', kind: 'headphones', connected, batteryPercent })

function deviceFired(readings: BluetoothDevice[][]) {
  let armed: ArmedDevices = {}
  const out: string[] = []
  for (const reading of readings) {
    const result = crossDevices(armed, reading)
    armed = result.armed
    out.push(...result.crossed.map((c) => `${c.device.name} ${c.threshold}`))
  }
  return out
}

describe('accessory batteries', () => {
  it('warns once at 20 % and once at 10 % per device', () => {
    expect(deviceFired([[pods(40)], [pods(20)], [pods(18)], [pods(10)], [pods(5)]])).toEqual(['AirPods 20', 'AirPods 10'])
  })

  it('is quiet on the first reading and re-arms after charging', () => {
    expect(deviceFired([[pods(15)], [pods(12)]])).toEqual([])
    expect(deviceFired([[pods(25)], [pods(19)], [pods(80)], [pods(19)]])).toEqual(['AirPods 20', 'AirPods 20'])
  })

  it('starts over when a device disconnects or loses its level', () => {
    expect(deviceFired([[pods(25)], [pods(25, false)], [pods(15)]])).toEqual([])
    expect(deviceFired([[pods(25)], [pods(undefined)], [pods(15)]])).toEqual([])
  })

  it('lists low devices to charge with the Mac, lowest first', () => {
    const mouse: BluetoothDevice = { id: 'm', name: 'Mouse', kind: 'mouse', connected: true, batteryPercent: 12 }
    expect(lowDevices([pods(25), mouse, pods(60)]).map((d) => d.name)).toEqual(['Mouse', 'AirPods'])
    expect(lowDevices([pods(25, false)])).toEqual([])
  })
})
