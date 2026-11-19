/** Launches remembered per result; enough to tell a habit from a one-off. */
const KEEP = 10
const HOUR = 3_600_000
/** Weight of one launch by its age, as browsers rank their address-bar history. */
const BUCKETS: [maxAge: number, weight: number][] = [
  [4 * HOUR, 100],
  [24 * HOUR, 80],
  [3 * 24 * HOUR, 60],
  [7 * 24 * HOUR, 40],
  [30 * 24 * HOUR, 20],
]
const OLD = 10

/** Result id → timestamps of its latest launches, newest first. */
export type Frecency = Record<string, number[]>

export function record(frecency: Frecency, id: string, now = Date.now()): Frecency {
  return { ...frecency, [id]: [now, ...(frecency[id] ?? [])].slice(0, KEEP) }
}

/** Frequent and recent launches score high; nothing launched, 0. */
export function frecencyScore(frecency: Frecency, id: string, now = Date.now()): number {
  let score = 0
  for (const at of frecency[id] ?? []) {
    const age = now - at
    score += BUCKETS.find(([max]) => age < max)?.[1] ?? OLD
  }
  return score
}

/** A good match beats a habit, but between close matches the habit wins: "s" opens the Safari you use. */
export const rankScore = (match: number, frecency: number) => (match > 0 ? match + Math.min(frecency, 600) * 0.4 : 0)
