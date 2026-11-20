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

/** What the user picked for what they typed: query (normalized) → result id → times picked, newest first. */
export type Knowledge = Record<string, Record<string, number[]>>
/** Queries remembered; the least recently used go first. */
const QUERIES = 300
const PICKS = 5

/** Remembers that `id` was picked for `query`. */
export function learn(knowledge: Knowledge, query: string, id: string, now = Date.now()): Knowledge {
  if (!query) return knowledge
  const picks = knowledge[query] ?? {}
  const next: Knowledge = { ...knowledge, [query]: { ...picks, [id]: [now, ...(picks[id] ?? [])].slice(0, PICKS) } }
  const queries = Object.keys(next)
  if (queries.length <= QUERIES) return next
  const last = (q: string) => Math.max(...Object.values(next[q]).map((times) => times[0] ?? 0))
  for (const q of queries.sort((a, b) => last(a) - last(b)).slice(0, queries.length - QUERIES)) delete next[q]
  return next
}

/** The most the knowledge adds: enough for one pick of "Home" for "home" to beat a habitual "HomeControl". */
const BOOST_MAX = 400

/**
 * How much picking `id` for this query (or one it leads to) before lifts it now. The same query counts in full,
 * a query this one is the start of ("ho" → "home") by how much of it is typed, and a shorter one it continues
 * ("home" after "ho") by half; each by how often and how lately it was picked.
 */
export function queryBoost(knowledge: Knowledge, query: string, id: string, now = Date.now()): number {
  if (!query) return 0
  let best = 0
  for (const [typed, picks] of Object.entries(knowledge)) {
    const times = picks[id]
    if (!times) continue
    const closeness = typed === query ? 1 : typed.startsWith(query) ? query.length / typed.length : query.startsWith(typed) ? 0.5 : 0
    if (closeness) best = Math.max(best, closeness * Math.min(2 * frecencyScore({ [id]: times }, id, now), BOOST_MAX))
  }
  return best
}
