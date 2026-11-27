import type { CurrencyRates } from '@just-notch/bridge-schema'
import { formatFixed, formatNumber, parseNumber } from './format'
import type { InlineAnswer } from './types'

const SYMBOLS: Record<string, string> = {
  $: 'USD', us$: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₽': 'RUB', kč: 'CZK', zł: 'PLN', '₹': 'INR', '₩': 'KRW',
  '₺': 'TRY', '₴': 'UAH', '₪': 'ILS', 'r$': 'BRL', c$: 'CAD', ca$: 'CAD', a$: 'AUD', au$: 'AUD', fr: 'CHF',
}

const NAMES: Record<string, string> = {
  dollar: 'USD', buck: 'USD', euro: 'EUR', pound: 'GBP', quid: 'GBP', yen: 'JPY', ruble: 'RUB', rouble: 'RUB',
  koruna: 'CZK', crown: 'CZK', zloty: 'PLN', złoty: 'PLN', rupee: 'INR', yuan: 'CNY', renminbi: 'CNY', won: 'KRW',
  franc: 'CHF', lira: 'TRY', hryvnia: 'UAH', hryvnya: 'UAH', грн: 'UAH', tenge: 'KZT', lari: 'GEL', dirham: 'AED',
  riyal: 'SAR', dong: 'VND', manat: 'AZN', taka: 'BDT', real: 'BRL', reais: 'BRL', peso: 'MXN', forint: 'HUF', shekel: 'ILS',
}

// [prefix symbol] amount [currency] (in|to|→) currency
const PATTERN =
  /^([^\d\s.,-]{1,3})?\s*(\d+(?:[.,]\d+)*|[.,]\d+)\s*([^\d\s]*?)(?:\s+(?:in|to|into|as)\s+|\s*(?:->|→|=)\s*)([^\d\s]+)$/i

const rateOf = (code: string, rates: CurrencyRates) => (code === 'EUR' ? 1 : rates.rates[code])

function currencyCode(word: string, rates: CurrencyRates): string | null {
  const w = word.toLowerCase()
  const code = SYMBOLS[w] ?? NAMES[w] ?? NAMES[w.replace(/e?s$/, '')] ?? NAMES[w.replace(/s$/, '')] ?? w.toUpperCase()
  return /^[A-Z]{3}$/.test(code) && rateOf(code, rates) ? code : null
}

function fractionDigits(code: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2
}

export function currencyAnswer(input: string, rates: CurrencyRates | null | undefined, locale?: string): InlineAnswer | null {
  const m = input.match(PATTERN)
  if (!m || !rates) return null
  const [, prefix, rawAmount, suffix, target] = m
  if (prefix && suffix) return null
  const from = currencyCode(prefix ?? suffix, rates)
  const to = currencyCode(target, rates)
  const amount = parseNumber(rawAmount, locale)
  if (!from || !to || !Number.isFinite(amount)) return null

  const value = (amount * rateOf(to, rates)) / rateOf(from, rates)
  const digits = fractionDigits(to)
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const day = (iso: string) => date.format(new Date(`${iso}T00:00:00Z`))
  const extra = rates.extra && [from, to].some((code) => rates.extra?.codes.includes(code)) ? rates.extra : null
  return {
    kind: 'currency',
    expression: `${formatNumber(amount, locale)} ${from} → ${to}`,
    result: `${formatFixed(value, digits, locale)} ${to}`,
    copy: value.toFixed(digits),
    detail: extra ? `ECB and NBU rates of ${day(extra.date)}` : `ECB rates of ${day(rates.date)}`,
  }
}
