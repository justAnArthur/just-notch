import type { NetworkState } from '@just-notch/sdk'

export type Notice =
  | { kind: 'offline'; was?: NetworkState['kind'] }
  | { kind: 'online'; offlineFor: number }
  | { kind: 'vpnLost' }
  | { kind: 'slow'; latencyMs: number }
  | { kind: 'dropping' }
  | { kind: 'recovered' }

/** What the plugin remembers between readings. */
export interface Memory {
  offlineSince?: number
  /** In this call: warned about a slow or dropping connection, until it recovers. */
  warned: boolean
}

export const SLOW_MS = 400
export const GOOD_MS = 200
/** Back online after less than this isn't news (a Wi-Fi roam). */
const BLIP_MS = 5000

export const initialMemory: Memory = { warned: false }

/** The notices a new reading brings. Never on the first reading; at most one warning per bad stretch of a call. */
export function evaluate(before: NetworkState | undefined, after: NetworkState, memory: Memory, now: number): { notices: Notice[]; memory: Memory } {
  const notices: Notice[] = []
  let next = { ...memory }
  if (!before) return { notices, memory: after.online ? next : { ...next, offlineSince: now } }

  if (before.online && !after.online) {
    notices.push({ kind: 'offline', was: before.kind })
    next.offlineSince = now
  } else if (!before.online && after.online) {
    const since = next.offlineSince ?? now
    if (now - since >= BLIP_MS) notices.push({ kind: 'online', offlineFor: now - since })
    next.offlineSince = undefined
  }

  if (before.vpn && !after.vpn && after.online) notices.push({ kind: 'vpnLost' })

  if (!after.inCall) next = { ...next, warned: false }
  else if (after.online) {
    const dropping = after.failedProbes >= 2
    const slow = after.latencyMs !== undefined && after.latencyMs > SLOW_MS
    const good = after.failedProbes === 0 && after.latencyMs !== undefined && after.latencyMs < GOOD_MS
    if (!next.warned && dropping) notices.push({ kind: 'dropping' })
    else if (!next.warned && slow) notices.push({ kind: 'slow', latencyMs: after.latencyMs! })
    if (dropping || slow) next.warned = true
    else if (good && next.warned) {
      notices.push({ kind: 'recovered' })
      next.warned = false
    }
  }
  return { notices, memory: next }
}
