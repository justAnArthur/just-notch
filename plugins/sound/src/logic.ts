import type { AudioDevice, AudioDevices } from '@just-notch/sdk'

export interface Switched {
  output?: AudioDevice
  input?: AudioDevice
}

const byId = (devices: AudioDevice[], id: string | undefined) => (id === undefined ? undefined : devices.find((d) => d.id === id))

/** What moved between two readings: the new default output and input. Nothing on the first reading. */
export function switched(before: AudioDevices | undefined, after: AudioDevices): Switched {
  if (!before) return {}
  const out: Switched = {}
  if (after.output !== before.output) out.output = byId(after.outputs, after.output)
  if (after.input !== before.input) out.input = byId(after.inputs, after.input)
  return out
}

/** Merges switches that arrive in a burst (AirPods move the output, then the input). */
export const merge = (a: Switched, b: Switched): Switched => ({ output: b.output ?? a.output, input: b.input ?? a.input })

/** How the flash words a switch. */
export function wording({ output, input }: Switched): { title: string; caption: string } | null {
  if (output && input && output.name === input.name) return { title: output.name, caption: 'Sound and microphone' }
  if (output && input) return { title: output.name, caption: `Sound here · mic: ${input.name}` }
  if (output) return { title: output.name, caption: 'Sound plays here now' }
  if (input) return { title: input.name, caption: 'Microphone switched' }
  return null
}

/**
 * While an app records (a call) through a Bluetooth headset's mic: the built-in mic to offer instead. A headset's
 * mic forces the low-quality call profile, so the call sounds worse on both ends. Null when there's nothing to suggest.
 */
export function betterMic(state: AudioDevices): AudioDevice | null {
  if (!state.micInUse) return null
  const input = byId(state.inputs, state.input)
  if (input?.transport !== 'bluetooth') return null
  return state.inputs.find((d) => d.transport === 'builtIn') ?? null
}

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
const WORDS = ['sound', 'audio', 'output', 'speaker', 'speakers', 'headphones', 'mic', 'microphone', 'input']

/** Whether a root-search query is about sound: one of its words, or the start of a device's name. */
export function matches(query: string, devices: AudioDevice[]): boolean {
  const q = fold(query.trim())
  if (q.length < 2) return false
  return WORDS.some((w) => w.startsWith(q) || q.startsWith(w)) || devices.some((d) => fold(d.name).split(/\s+/).some((word) => word.startsWith(q)) || fold(d.name).startsWith(q))
}
