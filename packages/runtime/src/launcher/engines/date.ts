import { formatDay, formatNumber } from './format'
import type { AnswerEnv, InlineAnswer } from './types'

const DAY = 86_400_000
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const HOLIDAYS: Record<string, [month: number, day: number]> = {
  christmas: [12, 25], xmas: [12, 25], 'christmas eve': [12, 24], 'christmas day': [12, 25], 'new year': [1, 1],
  'new years': [1, 1], 'new years day': [1, 1], 'new years eve': [12, 31], halloween: [10, 31], valentines: [2, 14],
  'valentines day': [2, 14],
}

type Span = { n: number; unit: 'day' | 'week' | 'month' | 'year' }
const SPAN = String.raw`(\d+|an?|one) (day|week|fortnight|month|year)s?`

function parseSpan(count: string, unit: string): Span {
  const n = /^\d+$/.test(count) ? Number(count) : 1
  return unit === 'fortnight' ? { n: n * 2, unit: 'week' } : { n, unit: unit as Span['unit'] }
}

/** Dates are UTC midnights, so day arithmetic never meets daylight saving. */
const utcDay = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day))
const iso = (date: Date) => date.toISOString().slice(0, 10)

function today(env: AnswerEnv & { timeZone: string }): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: env.timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(env.now ?? new Date())
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return utcDay(get('year'), get('month'), get('day'))
}

function addMonths(date: Date, n: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + n
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay)))
}

function add(date: Date, { n, unit }: Span, sign: 1 | -1): Date {
  if (unit === 'day') return new Date(date.getTime() + sign * n * DAY)
  if (unit === 'week') return new Date(date.getTime() + sign * n * 7 * DAY)
  return addMonths(date, sign * n * (unit === 'year' ? 12 : 1))
}

const monthOf = (word: string) => (word.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(word)) + 1 : 0)

/** A valid calendar day, or null for "31 feb". */
function calendarDay(year: number, month: number, day: number): Date | null {
  const date = utcDay(year, month, day)
  return month >= 1 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null
}

/**
 * "today", "2026-12-24", "24 dec", "december 24, 2027", "24.12.", "christmas". Without a year, picks the next
 * occurrence (or the last one when `past`).
 */
function parseDate(text: string, base: Date, past = false): Date | null {
  const s = text.replace(/'/g, '').replace(/^the /, '')
  if (s === 'today' || s === 'now') return base
  if (s === 'tomorrow') return add(base, { n: 1, unit: 'day' }, 1)
  if (s === 'yesterday') return add(base, { n: 1, unit: 'day' }, -1)

  let year: number | undefined
  let month = 0
  let day = 0
  let m: RegExpMatchArray | null
  if (HOLIDAYS[s]) [month, day] = HOLIDAYS[s]
  else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?,?(?: (\d{4}))?$/))) [day, month, year] = [Number(m[1]), monthOf(m[2]), m[3] ? Number(m[3]) : undefined]
  else if ((m = s.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,?(?: (\d{4}))?$/))) [month, day, year] = [monthOf(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined]
  else if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/))) [day, month, year] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined]
  else return null

  if (year !== undefined) return calendarDay(year, month, day)
  const thisYear = calendarDay(base.getUTCFullYear(), month, day)
  if (!thisYear) return null
  if (!past && thisYear < base) return calendarDay(base.getUTCFullYear() + 1, month, day)
  if (past && thisYear > base) return calendarDay(base.getUTCFullYear() - 1, month, day)
  return thisYear
}

const days = (n: number, locale?: string) => `${formatNumber(n, locale)} ${Math.abs(n) === 1 ? 'day' : 'days'}`
const spanText = ({ n, unit }: Span) => `${n} ${unit}${n === 1 ? '' : 's'}`

export function dateAnswer(input: string, env: AnswerEnv & { timeZone: string }): InlineAnswer | null {
  const s = input.toLowerCase().replace(/\s+/g, ' ').trim()
  const base = today(env)
  const locale = env.locale

  const shifted = (date: Date, expression: string): InlineAnswer => ({ kind: 'date', expression, result: formatDay(date, locale), copy: iso(date) })
  let m: RegExpMatchArray | null
  if ((m = s.match(new RegExp(`^in ${SPAN}$`))) || (m = s.match(new RegExp(`^${SPAN} (?:from now|from today|later)$`)))) {
    const span = parseSpan(m[1], m[2])
    return shifted(add(base, span, 1), `Today + ${spanText(span)}`)
  }
  if ((m = s.match(new RegExp(`^${SPAN} ago$`)))) {
    const span = parseSpan(m[1], m[2])
    return shifted(add(base, span, -1), `Today − ${spanText(span)}`)
  }
  if ((m = s.match(new RegExp(`^(.+?) ?([+-]) ?${SPAN}$`)))) {
    const from = parseDate(m[1], base)
    const span = parseSpan(m[3], m[4])
    if (!from) return null
    return shifted(add(from, span, m[2] === '+' ? 1 : -1), `${formatDay(from, locale)} ${m[2] === '+' ? '+' : '−'} ${spanText(span)}`)
  }
  if ((m = s.match(/^(?:how many )?days? (until|till|til|to|before|since|from) (.+?)\??$/))) {
    const since = m[1] === 'since' || m[1] === 'from'
    const target = parseDate(m[2], base, since)
    if (!target) return null
    const n = Math.round((since ? base.getTime() - target.getTime() : target.getTime() - base.getTime()) / DAY)
    return { kind: 'date', expression: `Days ${since ? 'since' : 'until'} ${formatDay(target, locale)}`, result: days(n, locale), copy: String(n) }
  }
  if ((m = s.match(/^(.+?) - (.+)$/))) {
    const a = parseDate(m[1], base)
    const b = parseDate(m[2], base)
    if (!a || !b) return null
    const n = Math.round((a.getTime() - b.getTime()) / DAY)
    return { kind: 'date', expression: `${formatDay(a, locale)} − ${formatDay(b, locale)}`, result: days(n, locale), copy: String(n) }
  }
  return null
}
