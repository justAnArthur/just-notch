import { currencyAnswer } from './currency'
import { dateAnswer } from './date'
import { mathAnswer } from './math'
import { timeAnswer } from './time'
import type { AnswerEnv, InlineAnswer } from './types'
import { unitAnswer } from './units'

export type { AnswerEnv, InlineAnswer } from './types'

/**
 * One inline answer for what's typed in the launcher (maths, units, currency, time zones, dates), or null when
 * the input isn't clearly one of those. Plain words and a lone number give null.
 */
export function inlineAnswer(input: string, env: AnswerEnv = {}): InlineAnswer | null {
  const text = input.replace(/\s+/g, ' ').trim()
  if (!text || text.length > 200) return null
  const full = { ...env, timeZone: env.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone }
  try {
    return (
      dateAnswer(text, full) ??
      timeAnswer(text, full) ??
      unitAnswer(text, env.locale) ??
      currencyAnswer(text, env.rates, env.locale) ??
      mathAnswer(text, env.locale)
    )
  } catch {
    return null // an unknown locale or zone from the host shouldn't break typing
  }
}
