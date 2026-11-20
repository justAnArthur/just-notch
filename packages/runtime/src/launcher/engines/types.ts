import type { CurrencyRates } from '@just-notch/bridge-schema'

export interface InlineAnswer {
  kind: 'math' | 'unit' | 'currency' | 'time' | 'date' | 'base'
  /** The input as understood, tidied for display: "15% of 80", "12 USD → EUR". */
  expression: string
  /** The answer as shown, formatted for the locale: "12", "11.04 EUR", "17:00 in Tokyo (Fri)". */
  result: string
  /** What ⌘C / ↩ copies: the bare value ("11.04"), unformatted digits with '.' decimal. */
  copy: string
  /** Small print under it, e.g. "ECB rates of 18 Nov 2026" or "Europe/London → Asia/Tokyo". */
  detail?: string
}

export interface AnswerEnv {
  rates?: CurrencyRates | null
  now?: Date
  locale?: string
  timeZone?: string
  /** The last result copied or pasted, which `ans` stands for. */
  ans?: number
}
