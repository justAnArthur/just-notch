const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

/** "Last checked 3 hours ago", "Last checked just now", or "Never checked" before Sparkle's first check. */
export function lastCheckedText(lastChecked: number | null, now = Date.now()): string {
  if (lastChecked === null) return 'Never checked'
  const elapsed = Math.max(0, now - lastChecked)
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  for (const [unit, ms] of UNITS) if (elapsed >= ms) return `Last checked ${format.format(-Math.floor(elapsed / ms), unit)}`
  return 'Last checked just now'
}
