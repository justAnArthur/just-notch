import { describe, expect, it } from 'bun:test'
import type { AudioDevices } from '@just-notch/sdk'
import { betterMic, matches, merge, switched, wording } from '../src/logic'

const speakers = { id: 'so', name: 'MacBook Pro Speakers', transport: 'builtIn' as const }
const builtInMic = { id: 'si', name: 'MacBook Pro Microphone', transport: 'builtIn' as const }
const podsOut = { id: 'po', name: 'AirPods Pro', transport: 'bluetooth' as const }
const podsIn = { id: 'pi', name: 'AirPods Pro', transport: 'bluetooth' as const }
const state = (output: string, input: string, micInUse = false): AudioDevices => ({
  outputs: [speakers, podsOut],
  inputs: [builtInMic, podsIn],
  output,
  input,
  micInUse,
})

describe('switches', () => {
  it('reports what moved, never on the first reading', () => {
    expect(switched(undefined, state('po', 'pi'))).toEqual({})
    expect(switched(state('so', 'si'), state('po', 'si'))).toEqual({ output: podsOut })
    expect(switched(state('so', 'si'), state('po', 'pi'))).toEqual({ output: podsOut, input: podsIn })
    expect(switched(state('so', 'si'), state('so', 'si', true))).toEqual({})
  })

  it('words a burst as one flash', () => {
    const burst = merge({ output: podsOut }, { input: podsIn })
    expect(wording(burst)).toEqual({ title: 'AirPods Pro', caption: 'Sound and microphone' })
    expect(wording({ output: speakers })).toEqual({ title: 'MacBook Pro Speakers', caption: 'Sound plays here now' })
    expect(wording({ input: builtInMic })?.caption).toBe('Microphone switched')
    expect(wording({})).toBeNull()
  })
})

describe('call microphone', () => {
  it("offers the built-in mic during a call on AirPods' mic", () => {
    expect(betterMic(state('po', 'pi', true))).toEqual(builtInMic)
    expect(betterMic(state('po', 'pi', false))).toBeNull()
    expect(betterMic(state('po', 'si', true))).toBeNull()
  })
})

describe('launcher', () => {
  it('answers sound words and device names', () => {
    const devices = [speakers, podsOut]
    expect(matches('sou', devices)).toBe(true)
    expect(matches('mic', devices)).toBe(true)
    expect(matches('airp', devices)).toBe(true)
    expect(matches('pro', devices)).toBe(true)
    expect(matches('safari', devices)).toBe(false)
    expect(matches('a', devices)).toBe(false)
  })
})
