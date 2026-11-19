const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
}

export function decimalSeparator(locale?: string): string {
  return new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.'
}

/**
 * Reads "1,000.5", "1.000,5", "0,5" or "1,000". With two different separators the last is the decimal. A lone
 * one is the decimal unless it is not the locale's decimal and sits before exactly three digits ("1,000" in en).
 */
export function parseNumber(raw: string, locale?: string): number {
  const seps: string[] = raw.match(/[.,]/g) ?? []
  if (seps.length === 0) return Number(raw)
  const kinds = [...new Set(seps)]
  let decimal: string | null
  if (kinds.length === 2) decimal = seps[seps.length - 1]
  else if (seps.length > 1) decimal = null
  else decimal = seps[0] !== decimalSeparator(locale) && /^[1-9]\d{0,2}[.,]\d{3}$/.test(raw) ? null : seps[0]

  const [int, frac = '0', extra] = decimal ? raw.split(decimal) : [raw]
  if (extra !== undefined || /[.,]/.test(frac)) return Number.NaN
  const group = kinds.find((c) => c !== decimal)
  if (group && !new RegExp(`^\\d{1,3}(\\${group}\\d{3})*$`).test(int)) return Number.NaN
  return Number(`${group ? int.split(group).join('') : int}.${frac}`)
}

/** Rounds to `digits` significant digits, which also drops float noise (0.1 + 0.2). */
export function roundSig(n: number, digits = 10): number {
  return n === 0 ? 0 : Number(n.toPrecision(digits)) || 0
}

/** The bare value to copy: '.' decimal, no grouping. */
export function plain(n: number, digits = 10): string {
  return String(roundSig(n, digits))
}

/** For display: grouped per locale, and "1.5 × 10²⁰" when very large or small. */
export function formatNumber(n: number, locale?: string, digits = 10): string {
  const r = roundSig(n, digits)
  const abs = Math.abs(r)
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) {
    const parts = new Intl.NumberFormat(locale, { notation: 'scientific', maximumSignificantDigits: digits }).formatToParts(r)
    const at = parts.findIndex((p) => p.type === 'exponentSeparator')
    const mantissa = parts.slice(0, at).map((p) => p.value).join('')
    const exponent = parts.slice(at + 1).map((p) => (p.type === 'exponentMinusSign' ? '-' : p.value)).join('')
    return `${mantissa} × 10${[...exponent].map((c) => SUPERSCRIPT[c] ?? c).join('')}`
  }
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: digits }).format(r)
}

/** Fixed fraction digits, for money. */
export function formatFixed(n: number, digits: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
}

/** A date at UTC midnight, shown as "Thu, 10 Dec 2026" (the order follows the locale). */
export function formatDay(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}
