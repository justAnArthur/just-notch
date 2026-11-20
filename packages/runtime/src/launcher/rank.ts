import { type Frecency, frecencyScore, type Knowledge, queryBoost, rankScore } from './frecency'
import type { Row, Section } from './rows'

/** A row and how well it matches the query, as its provider judged (0–1000, see match.ts). */
export interface Scored {
  row: Row
  match: number
}

/** One provider's rows in the root search, under its title. */
export interface Group {
  title: string
  rows: Scored[]
  /** The provider failed: its rows are one error row, kept after every result and never the Top Hit. */
  failed?: boolean
}

export interface RankInput {
  /** The normalized query, for what was picked for it before. */
  query: string
  groups: Group[]
  frecency: Frecency
  knowledge: Knowledge
  /** The inline answer's section: first when there is one. */
  answer?: Section
  /** The fallback searches (the web, quicklinks): always last. */
  web?: Row[]
  now?: number
}

/**
 * The root search as one ranking: every row scores its match plus how often and how lately it was picked, overall
 * and for this query. The best row from any provider is the Top Hit; then each provider's section, best first,
 * ordered by its best row; then failed providers; then the web.
 */
export function rankRoot({ query, groups, frecency, knowledge, answer, web, now = Date.now() }: RankInput): Section[] {
  const score = ({ row, match }: Scored) =>
    match > 0 ? rankScore(match, frecencyScore(frecency, row.id, now)) + queryBoost(knowledge, query, row.id, now) : 0

  const scoredGroups = groups
    .filter((g) => !g.failed)
    .map((g) => ({ title: g.title, rows: g.rows.map((s) => ({ row: s.row, score: score(s) })).filter((s) => s.score > 0) }))
  // A row two providers return (an aliased app, also matched by name) shows once, where it scores best.
  const best = new Map<string, number>()
  for (const g of scoredGroups) for (const s of g.rows) best.set(s.row.id, Math.max(best.get(s.row.id) ?? 0, s.score))
  const seen = new Set<string>()
  const ranked = scoredGroups.map((g) => ({
    ...g,
    rows: g.rows
      .filter((s) => s.score === best.get(s.row.id) && !seen.has(s.row.id) && seen.add(s.row.id))
      .sort((a, b) => b.score - a.score),
  }))

  let top: { row: Row; score: number } | undefined
  for (const g of ranked) if (g.rows[0] && (!top || g.rows[0].score > top.score)) top = g.rows[0]

  const rest = ranked
    .map((g) => ({ title: g.title, rows: g.rows.filter((s) => s !== top) }))
    .filter((g) => g.rows.length)
    .sort((a, b) => b.rows[0].score - a.rows[0].score)

  return [
    ...(answer ? [answer] : []),
    ...(top ? [{ title: 'Top Hit', rows: [top.row] }] : []),
    ...rest.map((g) => ({ title: g.title, rows: g.rows.map((s) => s.row) })),
    ...groups.filter((g) => g.failed).map((g) => ({ title: g.title, rows: g.rows.map((s) => s.row) })),
    ...(web?.length ? [{ title: 'Web', rows: web }] : []),
  ]
}
