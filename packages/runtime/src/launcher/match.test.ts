import { describe, expect, it } from 'vitest'
import { frecencyScore, rankScore, record } from './frecency'
import { bestScore, matchScore, normalize } from './match'
import { acceleratorOf, formatAccelerator } from './shortcut'

const rank = (query: string, names: string[]) =>
  names
    .map((name) => [name, matchScore(query, name)] as const)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)

describe('matchScore', () => {
  it('ranks exact, then prefix, then word start, then initials, then substring, then fuzzy', () => {
    const exact = matchScore('notes', 'Notes')
    const prefix = matchScore('not', 'Notes')
    const word = matchScore('set', 'System Settings')
    const initials = matchScore('vsc', 'Visual Studio Code')
    const inside = matchScore('fari', 'Safari')
    const fuzzy = matchScore('sfr', 'Safari')
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(initials)
    expect(initials).toBeGreaterThan(inside)
    expect(inside).toBeGreaterThan(fuzzy)
    expect(fuzzy).toBeGreaterThan(0)
  })

  it('misses what has the letters out of order', () => {
    expect(matchScore('xz', 'Zed')).toBe(0)
    expect(matchScore('', 'Zed')).toBe(0)
  })

  it('prefers the shorter of two prefix matches', () => {
    expect(rank('ma', ['Maps', 'Mail', 'Magnet Pro'])[2]).toBe('Magnet Pro')
  })

  it('finds an app by a later word and by initials', () => {
    expect(rank('code', ['Xcode', 'Visual Studio Code'])).toEqual(['Visual Studio Code', 'Xcode'])
    expect(rank('ss', ['Safari', 'System Settings'])[0]).toBe('System Settings')
  })

  it('ignores case, accents and separators', () => {
    expect(normalize('Café-Bar_App')).toBe('cafe bar app')
    expect(matchScore('cafe', 'Café')).toBe(1000)
  })

  it('counts other names, a little less', () => {
    expect(bestScore('system preferences', 'System Settings', ['System Preferences'])).toBe(950)
    expect(bestScore('chrome', 'Google Chrome', ['Chrome'])).toBe(950)
  })
})

describe('frecency', () => {
  const now = Date.UTC(2026, 10, 19)
  const hour = 3_600_000

  it('weighs recent launches more and keeps the last ten', () => {
    let f = {}
    for (let i = 0; i < 12; i++) f = record(f, 'safari', now - i * hour)
    expect((f as Record<string, number[]>).safari).toHaveLength(10)
    expect(frecencyScore(record({}, 'a', now - hour), 'a', now)).toBeGreaterThan(frecencyScore(record({}, 'a', now - 100 * hour), 'a', now))
    expect(frecencyScore({}, 'none', now)).toBe(0)
  })

  it('lets a habit break close ties but not beat a much better match', () => {
    const habit = frecencyScore(Object.fromEntries([['spotify', Array.from({ length: 10 }, () => now)]]), 'spotify', now)
    expect(rankScore(matchScore('s', 'Spotify'), habit)).toBeGreaterThan(rankScore(matchScore('s', 'Slack'), 0))
    expect(rankScore(matchScore('sl', 'Spotify'), habit)).toBeLessThan(rankScore(matchScore('sl', 'Slack'), 0))
    expect(rankScore(0, habit)).toBe(0)
  })
})

describe('shortcuts', () => {
  const key = (code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
    code,
    key: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  })

  it('makes accelerators from presses with a modifier', () => {
    expect(acceleratorOf(key('Space', { altKey: true }))).toBe('Alt+Space')
    expect(acceleratorOf(key('Space', { metaKey: true }))).toBe('Command+Space')
    expect(acceleratorOf(key('KeyK', { metaKey: true, shiftKey: true }))).toBe('Shift+Command+K')
    expect(acceleratorOf(key('F5'))).toBe('F5')
  })

  it('waits while only modifiers are held, and refuses a bare key', () => {
    expect(acceleratorOf(key('AltLeft', { altKey: true }))).toBeUndefined()
    expect(acceleratorOf(key('KeyA'))).toBeUndefined()
  })

  it('shows them as macOS does', () => {
    expect(formatAccelerator('Alt+Space')).toBe('⌥Space')
    expect(formatAccelerator('Command+Shift+K')).toBe('⇧⌘K')
    expect(formatAccelerator('CommandOrControl+Space')).toBe('⌘Space')
  })
})
