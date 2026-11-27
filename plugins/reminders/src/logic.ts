export interface Parsed {
  title: string
  /** Epoch ms; undefined: no time given. */
  due?: number
}

const MINUTE = 60_000

/** `5pm`, `5:30 pm`, `17:00`, `9` → [hour, minute], or null. */
function clock(text: string): [number, number] | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(text.trim())
  if (!m) return null
  let hour = Number(m[1])
  const minute = Number(m[2] ?? 0)
  const meridiem = m[3]?.toLowerCase()
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  // A bare number needs a meridiem or a colon to be a time: "remind 3 things" is not 3 o'clock.
  if (!meridiem && m[2] === undefined && !/^\d{1,2}$/.test(text.trim())) return null
  return [hour, minute]
}

function at(now: Date, [hour, minute]: [number, number], dayOffset: number | 'next'): number {
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setHours(hour, minute)
  if (dayOffset === 'next') {
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
  } else d.setDate(d.getDate() + dayOffset)
  return d.getTime()
}

/**
 * Reads what follows `remind` in the launcher: `call the bank at 5pm`, `5pm call the bank`, `in 20m stretch`,
 * `tomorrow pay rent`, `tomorrow at 9:30 standup`, `tonight take out the trash`. A time that has passed today means
 * tomorrow. Without a time the reminder has no due date.
 */
export function parseReminder(input: string, now = new Date()): Parsed | null {
  let text = input.trim().replace(/^(?:me\s+)?(?:to\s+)?/i, '')
  let due: number | undefined

  const take = (re: RegExp, make: (m: RegExpExecArray) => number | undefined) => {
    if (due !== undefined) return
    const m = re.exec(text)
    if (!m) return
    const value = make(m)
    if (value === undefined) return
    due = value
    text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()
  }

  // in 20m, in 2 hours, in 1.5h
  take(/(?:^|\s)in\s+(\d+(?:[.,]\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)(?=\s|$)/i, (m) => {
    const value = Number(m[1]!.replace(',', '.'))
    return now.getTime() + value * (m[2]!.toLowerCase().startsWith('h') ? 60 : 1) * MINUTE
  })
  // tomorrow [at] 9:30 / tomorrow
  take(/(?:^|\s)tomorrow(?:\s+(?:at\s+)?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?))?(?=\s|$)/i, (m) => at(now, (m[1] && clock(m[1])) || [9, 0], 1))
  take(/(?:^|\s)tonight(?=\s|$)/i, () => at(now, [20, 0], 0))
  take(/(?:^|\s)this evening(?=\s|$)/i, () => at(now, [18, 0], 0))
  // at 17:00, at 5pm, 5pm, 17:30 (start or end)
  take(/(?:^|\s)(?:at\s+)?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)|\d{1,2}[:.]\d{2})(?=\s|$)/i, (m) => {
    const time = clock(m[1]!)
    return time ? at(now, time, 'next') : undefined
  })
  take(/(?:^|\s)at\s+(\d{1,2})(?=\s|$)/i, (m) => {
    const time = clock(m[1]!)
    return time ? at(now, time, 'next') : undefined
  })

  const title = text.replace(/^(?:to\s+)/i, '').trim()
  if (!title) return null
  return { title: title[0]!.toUpperCase() + title.slice(1), due }
}

/** `at 17:00`, `tomorrow at 9:00`, `in 20 min`, for the launcher's row. */
export function describeDue(due: number | undefined, now = new Date()): string {
  if (due === undefined) return 'No time: just in Reminders'
  const minutes = Math.round((due - now.getTime()) / MINUTE)
  const time = new Date(due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (minutes < 60 && minutes >= 0) return `in ${minutes} min, at ${time}`
  const dayDiff = Math.round((new Date(due).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)
  return dayDiff === 0 ? `today at ${time}` : dayDiff === 1 ? `tomorrow at ${time}` : new Date(due).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}
