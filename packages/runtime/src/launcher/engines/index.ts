import { currencyAnswer } from './currency'
import { dateAnswer } from './date'
import { decimalSeparator, formatNumber, plain } from './format'
import { mathAnswer } from './math'
import { timeAnswer } from './time'
import type { AnswerEnv, InlineAnswer } from './types'
import { unitAnswer } from './units'

export type { AnswerEnv, InlineAnswer } from './types'

const ANS = /\bans\b/i
const ANS_ALL = /\bans\b/gi

/**
 * One inline answer for what's typed in the launcher (maths, units, currency, time zones, dates), or null when
 * the input isn't clearly one of those. Plain words and a lone number give null.
 */
export function inlineAnswer(input: string, env: AnswerEnv = {}): InlineAnswer | null {
  const typed = input.replace(/\s+/g, ' ').trim()
  if (!typed || typed.length > 200) return null
  // `ans` is the last result copied or pasted: alone it shows it, in a sum it stands for it.
  const ans = env.ans
  if (ANS.test(typed)) {
    if (ans === undefined) return null
    if (/^ans$/i.test(typed)) return { kind: 'math', expression: 'ans', result: formatNumber(ans, env.locale), copy: plain(ans) }
    // Written as the locale writes numbers, so a comma-decimal locale reads it right.
    const literal = plain(ans).replace('.', decimalSeparator(env.locale))
    const found = inlineAnswer(typed.replace(ANS_ALL, `(${literal})`), { ...env, ans: undefined })
    return found && { ...found, expression: typed }
  }
  const text = typed
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
