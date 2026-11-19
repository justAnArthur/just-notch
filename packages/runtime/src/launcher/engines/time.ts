import type { AnswerEnv, InlineAnswer } from './types'

const CITIES: Record<string, string> = {
  london: 'Europe/London', dublin: 'Europe/Dublin', lisbon: 'Europe/Lisbon', reykjavik: 'Atlantic/Reykjavik',
  paris: 'Europe/Paris', berlin: 'Europe/Berlin', prague: 'Europe/Prague', vienna: 'Europe/Vienna',
  madrid: 'Europe/Madrid', barcelona: 'Europe/Madrid', rome: 'Europe/Rome', milan: 'Europe/Rome',
  amsterdam: 'Europe/Amsterdam', brussels: 'Europe/Brussels', zurich: 'Europe/Zurich', geneva: 'Europe/Zurich',
  stockholm: 'Europe/Stockholm', oslo: 'Europe/Oslo', copenhagen: 'Europe/Copenhagen', helsinki: 'Europe/Helsinki',
  warsaw: 'Europe/Warsaw', budapest: 'Europe/Budapest', bratislava: 'Europe/Bratislava', bucharest: 'Europe/Bucharest',
  athens: 'Europe/Athens', istanbul: 'Europe/Istanbul', kyiv: 'Europe/Kyiv', moscow: 'Europe/Moscow',
  cairo: 'Africa/Cairo', lagos: 'Africa/Lagos', nairobi: 'Africa/Nairobi', johannesburg: 'Africa/Johannesburg',
  'tel aviv': 'Asia/Jerusalem', jerusalem: 'Asia/Jerusalem', dubai: 'Asia/Dubai', riyadh: 'Asia/Riyadh',
  tehran: 'Asia/Tehran', karachi: 'Asia/Karachi', mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata',
  'new delhi': 'Asia/Kolkata', bangalore: 'Asia/Kolkata', kolkata: 'Asia/Kolkata', dhaka: 'Asia/Dhaka',
  bangkok: 'Asia/Bangkok', 'ho chi minh city': 'Asia/Ho_Chi_Minh', jakarta: 'Asia/Jakarta', singapore: 'Asia/Singapore',
  'kuala lumpur': 'Asia/Kuala_Lumpur', manila: 'Asia/Manila', 'hong kong': 'Asia/Hong_Kong', shanghai: 'Asia/Shanghai',
  beijing: 'Asia/Shanghai', taipei: 'Asia/Taipei', seoul: 'Asia/Seoul', tokyo: 'Asia/Tokyo', osaka: 'Asia/Tokyo',
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', brisbane: 'Australia/Brisbane', perth: 'Australia/Perth',
  adelaide: 'Australia/Adelaide', auckland: 'Pacific/Auckland', honolulu: 'Pacific/Honolulu', anchorage: 'America/Anchorage',
  'los angeles': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', seattle: 'America/Los_Angeles',
  vancouver: 'America/Vancouver', denver: 'America/Denver', phoenix: 'America/Phoenix', chicago: 'America/Chicago',
  dallas: 'America/Chicago', houston: 'America/Chicago', 'mexico city': 'America/Mexico_City', toronto: 'America/Toronto',
  montreal: 'America/Toronto', 'new york': 'America/New_York', boston: 'America/New_York', washington: 'America/New_York',
  miami: 'America/New_York', atlanta: 'America/New_York', bogota: 'America/Bogota', lima: 'America/Lima',
  santiago: 'America/Santiago', 'buenos aires': 'America/Argentina/Buenos_Aires', 'sao paulo': 'America/Sao_Paulo',
  'são paulo': 'America/Sao_Paulo', 'rio de janeiro': 'America/Sao_Paulo',
}

const ALIASES: Record<string, string> = {
  nyc: 'new york', la: 'los angeles', sf: 'san francisco', kiev: 'kyiv', bombay: 'mumbai', peking: 'beijing',
  saigon: 'ho chi minh city', dc: 'washington', 'washington dc': 'washington', rio: 'rio de janeiro',
}

/** Abbreviations name a fixed offset (PST is UTC−8 even in July); PT, ET… follow daylight saving. */
const ABBREVIATIONS: Record<string, string> = {
  utc: 'UTC', gmt: 'UTC', z: 'UTC', bst: 'Etc/GMT-1', cet: 'Etc/GMT-1', cest: 'Etc/GMT-2', eet: 'Etc/GMT-2',
  eest: 'Etc/GMT-3', wet: 'UTC', msk: 'Europe/Moscow', ist: 'Asia/Kolkata', jst: 'Asia/Tokyo', kst: 'Asia/Seoul',
  hkt: 'Asia/Hong_Kong', sgt: 'Asia/Singapore', aest: 'Etc/GMT-10', aedt: 'Etc/GMT-11', awst: 'Australia/Perth',
  nzst: 'Etc/GMT-12', nzdt: 'Etc/GMT-13', est: 'Etc/GMT+5', edt: 'Etc/GMT+4', cst: 'Etc/GMT+6', cdt: 'Etc/GMT+5',
  mst: 'Etc/GMT+7', mdt: 'Etc/GMT+6', pst: 'Etc/GMT+8', pdt: 'Etc/GMT+7', akst: 'Etc/GMT+9', hst: 'Pacific/Honolulu',
  et: 'America/New_York', ct: 'America/Chicago', mt: 'America/Denver', pt: 'America/Los_Angeles',
}

interface Zone {
  id: string
  label: string
}

const titleCase = (s: string) => s.replace(/(^|[\s/_])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())

function validZone(id: string): string | null {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: id }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

function resolveZone(raw: string, env: Required<Pick<AnswerEnv, 'timeZone'>>): Zone | null {
  const name = raw.toLowerCase().replace(/^the /, '').replace(/ time$/, '').trim()
  if (['here', 'local', 'local time'].includes(name)) return { id: env.timeZone, label: 'local time' }
  const city = ALIASES[name] ?? name
  if (CITIES[city]) return { id: CITIES[city], label: titleCase(city) }
  if (ABBREVIATIONS[name]) return { id: ABBREVIATIONS[name], label: name.toUpperCase() }
  const offset = name.match(/^(?:utc|gmt) ?([+\-−]) ?(\d{1,2})$/)
  if (offset && Number(offset[2]) <= 14) {
    const sign = offset[1] === '+' ? '-' : '+' // Etc/GMT signs are inverted
    return { id: Number(offset[2]) ? `Etc/GMT${sign}${Number(offset[2])}` : 'UTC', label: `UTC${offset[1] === '+' ? '+' : '−'}${Number(offset[2])}` }
  }
  if (name.includes('/')) {
    const id = validZone(name)
    if (id) return { id, label: titleCase(id.split('/').pop()!.replace(/_/g, ' ')) }
  }
  return null
}

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function partsIn(instant: number, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  })
  const get = (type: string) => Number(fmt.formatToParts(instant).find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

function offsetMs(instant: number, timeZone: string): number {
  const p = partsIn(instant, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000
}

/** The instant a wall-clock time happens in a zone, on that zone's current date. */
function wallClock(hour: number, minute: number, timeZone: string, now: number): number {
  const today = partsIn(now, timeZone)
  const guess = Date.UTC(today.year, today.month - 1, today.day, hour, minute)
  const first = guess - offsetMs(guess, timeZone)
  return guess - offsetMs(first, timeZone)
}

function offsetLabel(instant: number, timeZone: string): string {
  const minutes = Math.round(offsetMs(instant, timeZone) / 60000)
  if (minutes === 0) return 'UTC'
  const abs = Math.abs(minutes)
  return `UTC${minutes > 0 ? '+' : '−'}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`
}

/** "5pm", "5:30 pm", "17:00", "noon". */
function parseClock(s: string): { hour: number; minute: number } | null {
  if (s === 'noon') return { hour: 12, minute: 0 }
  if (s === 'midnight') return { hour: 0, minute: 0 }
  const twelve = s.match(/^(\d{1,2})(?:[:.](\d{2}))? ?([ap])\.?m?\.?$/)
  if (twelve) {
    const h = Number(twelve[1])
    const minute = Number(twelve[2] ?? 0)
    if (h < 1 || h > 12 || minute > 59) return null
    return { hour: (h % 12) + (twelve[3] === 'p' ? 12 : 0), minute }
  }
  const day = s.match(/^(\d{1,2})[:.](\d{2})$/)
  if (day && Number(day[1]) < 24 && Number(day[2]) < 60) return { hour: Number(day[1]), minute: Number(day[2]) }
  return null
}

/** "5pm london" → that instant; "5 pm" alone is local time. */
function parseMoment(s: string, env: Required<Pick<AnswerEnv, 'timeZone'>>, now: number): { instant: number; zone: Zone } | null {
  const words = s.split(' ')
  for (const take of [2, 1]) {
    const clockText = words.slice(0, take).join(' ')
    const clock = clockText === 'now' ? null : parseClock(clockText)
    if (!clock && clockText !== 'now') continue
    const rest = words.slice(take).join(' ')
    const zone = rest ? resolveZone(rest, env) : { id: env.timeZone, label: 'local time' }
    if (!zone) continue
    return { instant: clock ? wallClock(clock.hour, clock.minute, zone.id, now) : now, zone }
  }
  return null
}

function show(instant: number, zone: Zone, locale?: string) {
  const twelveHour = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12
  const hour = twelveHour ? 'numeric' : '2-digit' // "5:00 PM" but "02:00"
  const time = new Intl.DateTimeFormat(locale, { hour, minute: '2-digit', timeZone: zone.id }).format(instant)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: zone.id }).format(instant)
  const p = partsIn(instant, zone.id)
  const copy = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
  return { time, result: `${time} in ${zone.label} (${weekday})`, copy }
}

export function timeAnswer(input: string, env: AnswerEnv & { timeZone: string }): InlineAnswer | null {
  const s = input.toLowerCase().replace(/\s+/g, ' ').trim()
  const now = (env.now ?? new Date()).getTime()

  const current =
    s.match(/^(?:what(?:'s| is)? )?(?:the )?(?:current )?(?:time|now)(?: is it)? (?:in|at) (.+)$/) ?? s.match(/^(.+) time$/)
  if (current) {
    const zone = resolveZone(current[1], env)
    if (!zone) return null
    const shown = show(now, zone, env.locale)
    return { kind: 'time', expression: `Time in ${zone.label}`, result: shown.result, copy: shown.copy, detail: `${zone.id} · ${offsetLabel(now, zone.id)}` }
  }

  const convert = s.match(/^(.+?)(?: (?:in|to|into|as) | ?(?:->|→|=) ?)(.+)$/)
  if (!convert) return null
  const from = parseMoment(convert[1], env, now)
  const to = resolveZone(convert[2], env)
  if (!from || !to) return null
  const source = show(from.instant, from.zone, env.locale)
  const shown = show(from.instant, to, env.locale)
  const fromLabel = from.zone.label === 'local time' ? '' : ` ${from.zone.label}`
  return {
    kind: 'time',
    expression: `${source.time}${fromLabel} → ${to.label}`,
    result: shown.result,
    copy: shown.copy,
    detail: `${from.zone.id} → ${to.id}`,
  }
}
