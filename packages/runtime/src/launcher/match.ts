/** The best a fuzzy match (letters in order, apart) scores; every contiguous match scores more. */
export const FUZZY_MAX = 500
/** Letters in order but apart ("sfri" in Safari) count only from this many letters on: shorter, almost anything matches. */
const FUZZY_MIN = 4

/** How well a query matches a name, 0 for no match; higher is better. Same-tier ties go to the shorter name. */
export function matchScore(query: string, text: string): number {
  const q = normalize(query)
  const t = normalize(text)
  if (!q || !t) return 0
  if (t === q) return 1000
  if (t.startsWith(q)) return 900 - Math.min(t.length - q.length, 50)

  const words = wordStarts(t)
  // A later word's start: "code" in "Visual Studio Code", "set" in "System Settings".
  for (const start of words) if (start > 0 && t.startsWith(q, start)) return 800 - Math.min(start, 50)

  // Initials: "vsc" for Visual Studio Code, "ss" for System Settings.
  if (q.length >= 2 && initialsMatch(q, t, words)) return 700 - Math.min(words.length - q.length, 20)

  const index = t.indexOf(q)
  if (index >= 0) return 600 - Math.min(index, 50)

  if (q.replace(/ /g, '').length < FUZZY_MIN) return 0
  const fuzzy = subsequence(q, t, words)
  return Math.min(fuzzy, FUZZY_MAX)
}

/** The best score over a name and its other names; other names count a little less. */
export function bestScore(query: string, name: string, keywords: readonly string[] = []): number {
  let best = matchScore(query, name)
  for (const keyword of keywords) best = Math.max(best, matchScore(query, keyword) * 0.95)
  return best
}

/** Lowercase, accents dropped (é → e), runs of separators made one space. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\s_\-.]+/g, ' ')
    .trim()
}

/** Where words start: the first letter and every letter after a space. */
function wordStarts(text: string): number[] {
  const starts = [0]
  for (let i = 1; i < text.length; i++) if (text[i - 1] === ' ' && text[i] !== ' ') starts.push(i)
  return starts
}

/** Each query letter starts a word, in order (words may be skipped). */
function initialsMatch(query: string, text: string, starts: number[]): boolean {
  let qi = 0
  for (const start of starts) {
    if (qi < query.length && text[start] === query[qi]) qi++
  }
  return qi === query.length
}

/**
 * Every query letter in order from the start of a word: scored by how tight and word-aligned the match is.
 * "sfri" in "Safari" scores low, but scores. It still lets "term" into "Toggle Dark Mode", so the root keeps this
 * tier for apps only (see FUZZY_MAX).
 */
function subsequence(query: string, text: string, words: number[]): number {
  const q = query.replace(/ /g, '')
  const first = words.find((start) => text[start] === q[0])
  if (first === undefined) return 0
  const starts = new Set(words)
  let score = 300
  let previous = first
  for (const char of q.slice(1)) {
    const found = text.indexOf(char, previous + 1)
    if (found < 0) return 0
    if (found === previous + 1) score += 15
    else score -= Math.min(found - previous, 10) * 3
    if (starts.has(found)) score += 10
    previous = found
  }
  return Math.max(score, 1)
}
