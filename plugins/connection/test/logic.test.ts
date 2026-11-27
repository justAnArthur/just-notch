import { describe, expect, it } from 'bun:test'
import type { NetworkState } from '@just-notch/sdk'
import { evaluate, initialMemory, type Memory, type Notice } from '../src/logic'

const net = (change: Partial<NetworkState> = {}): NetworkState => ({ online: true, kind: 'wifi', vpn: false, inCall: false, failedProbes: 0, ...change })

function run(readings: [number, NetworkState][]): string[] {
  let before: NetworkState | undefined
  let memory: Memory = initialMemory
  const out: Notice[] = []
  for (const [at, state] of readings) {
    const result = evaluate(before, state, memory, at)
    memory = result.memory
    before = state
    out.push(...result.notices)
  }
  return out.map((n) => n.kind)
}

describe('connection notices', () => {
  it('says offline at once and back online only after a real outage', () => {
    expect(run([[0, net()], [1000, net({ online: false })], [3000, net()]])).toEqual(['offline'])
    expect(run([[0, net()], [1000, net({ online: false })], [20_000, net()]])).toEqual(['offline', 'online'])
  })

  it('notices a VPN that drops', () => {
    expect(run([[0, net({ vpn: true })], [1000, net()]])).toEqual(['vpnLost'])
    expect(run([[0, net({ vpn: true })], [1000, net({ online: false })]])).toEqual(['offline'])
  })

  it('warns once per bad stretch of a call, then says it recovered', () => {
    const call = (latencyMs: number, failedProbes = 0) => net({ inCall: true, latencyMs, failedProbes })
    expect(run([[0, call(50)], [5000, call(700)], [10_000, call(900)], [15_000, call(60)], [20_000, call(800)]])).toEqual(['slow', 'recovered', 'slow'])
    expect(run([[0, call(50)], [5000, call(50, 1)], [10_000, call(50, 2)]])).toEqual(['dropping'])
  })

  it('stays silent outside calls and on the first reading', () => {
    expect(run([[0, net({ latencyMs: 900 })], [5000, net({ latencyMs: 900 })]])).toEqual([])
    expect(run([[0, net({ online: false })]])).toEqual([])
  })
})
