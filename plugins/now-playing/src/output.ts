const OWNER = /^.+?['’]s\s+(?=\S)/
const KIND = /\s+(speakers?|headphones|output)$/i

/**
 * The output chip's short name: the device without its owner and kind, so "Arthur's AirPods Pro" reads
 * "AirPods Pro" and "MacBook Pro Speakers" reads "MacBook Pro". Undefined when nothing is left to shorten.
 */
export function shortOutput(device: string): string | undefined {
  const short = device.replace(OWNER, '').replace(KIND, '').trim()
  return short && short !== device ? short : undefined
}
