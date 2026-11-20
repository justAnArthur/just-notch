import { describe, expect, it } from 'vitest'
import { record } from './frecency'
import { mayHold } from './hotkeys'
import { aliasedIds, conflicts, DEFAULT_FALLBACKS, fallbackUrl, forget, heldHotkeys, moveFallback, quicklinkProblem, recentIds, shownFallbacks, snapshotOf, withDefaults } from './prefs'

const now = Date.UTC(2026, 10, 20)

describe('fallbacks', () => {
  it('starts with Google on, DuckDuckGo and Kagi off, and adds a new built-in to stored lists', () => {
    expect(withDefaults({}).fallbacks.map((f) => [f.id, f.enabled])).toEqual([['google', true], ['duckduckgo', false], ['kagi', false]])
    const stored = withDefaults({ fallbacks: [{ ...DEFAULT_FALLBACKS[2], enabled: true }] })
    expect(stored.fallbacks.map((f) => f.id)).toEqual(['kagi', 'google', 'duckduckgo'])
  })

  it('shows the first only beside results, up to three alone', () => {
    const all = withDefaults({}).fallbacks.map((f) => ({ ...f, enabled: true }))
    expect(shownFallbacks(all, true).map((f) => f.id)).toEqual(['google'])
    expect(shownFallbacks(all, false)).toHaveLength(3)
    expect(shownFallbacks(withDefaults({}).fallbacks, false).map((f) => f.id)).toEqual(['google'])
  })

  it('puts the query in the link and checks quicklinks', () => {
    expect(fallbackUrl(DEFAULT_FALLBACKS[0], 'a&b c')).toBe('https://www.google.com/search?q=a%26b%20c')
    expect(quicklinkProblem('https://github.com/search?q={query}')).toBeUndefined()
    expect(quicklinkProblem('github.com/{query}')).toBeDefined()
    expect(quicklinkProblem('https://github.com/search')).toBeDefined()
  })

  it('moves one place, never out of the list', () => {
    const list = withDefaults({}).fallbacks
    expect(moveFallback(list, 1, -1).map((f) => f.id)).toEqual(['duckduckgo', 'google', 'kagi'])
    expect(moveFallback(list, 0, -1)).toBe(list)
  })
})

describe('aliases and hotkeys', () => {
  const prefs = withDefaults({
    items: {
      'app:safari': { alias: 'sf', hotkey: 'Alt+Command+S' },
      'app:slack': { alias: 'SF ', hotkey: 'Command+Alt+S' },
      'file:readme': { hotkey: 'Alt+Space' },
      'action:sleep': { hotkey: 'Control+Alt+L' },
    },
  })
  const titles = { 'app:safari': 'Safari', 'app:slack': 'Slack' }

  it('finds results by alias, ignoring case and spaces', () => {
    expect(aliasedIds(prefs, ' Sf')).toEqual(['app:safari', 'app:slack'])
    expect(aliasedIds(prefs, '')).toEqual([])
  })

  it('names the conflicts: a shared alias or hotkey, the launcher’s own hotkey, and what the host refused', () => {
    expect(conflicts(prefs, titles, 'Alt+Space', { 'action:sleep': 'taken by another app' })).toEqual({
      'app:slack': 'Hotkey also on Safari',
      'file:readme': 'The launcher’s own hotkey',
      'action:sleep': 'taken by another app',
    })
  })

  it('holds one hotkey per result, never the launcher’s', () => {
    expect([...heldHotkeys(prefs, 'Alt+Space').keys()]).toEqual(['app:safari', 'action:sleep'])
  })

  it('lets one screen hold them: a free, own or stale lease', () => {
    expect(mayHold(null, 'a', now)).toBe(true)
    expect(mayHold({ screenId: 'a', at: now - 5_000 }, 'a', now)).toBe(true)
    expect(mayHold({ screenId: 'b', at: now - 5_000 }, 'a', now)).toBe(false)
    expect(mayHold({ screenId: 'b', at: now - 60_000 }, 'a', now)).toBe(true)
  })
})

describe('recent and ranking', () => {
  const snaps = { 'app:a': { id: 'app:a', title: 'A' }, 'app:b': { id: 'app:b', title: 'B' }, 'app:c': { id: 'app:c', title: 'C' } }

  it('lists the most used lately, without favourites or results it can’t show', () => {
    let f = {}
    for (let i = 0; i < 3; i++) f = record(f, 'app:b', now)
    f = record(f, 'app:a', now)
    f = record(f, 'app:c', now)
    f = record(f, 'app:gone', now)
    expect(recentIds(f, snaps, ['app:c'], now)).toEqual(['app:b', 'app:a'])
  })

  it('forgets a result’s launches and what it was picked for', () => {
    const out = forget({ 'app:a': [now], 'app:b': [now] }, { saf: { 'app:a': [now] }, s: { 'app:a': [now], 'app:b': [now] } }, 'app:a')
    expect(out).toEqual({ frecency: { 'app:b': [now] }, knowledge: { s: { 'app:b': [now] } } })
  })

  it('keeps what a result needs to be shown again, and nothing for the web search', () => {
    expect(snapshotOf({ id: 'app:x', title: 'X', icon: { path: '/Applications/X.app' }, actions: [] })).toEqual({ id: 'app:x', title: 'X', path: '/Applications/X.app' })
    expect(snapshotOf({ id: 'fallback:google', title: 'Search', actions: [] })).toBeUndefined()
  })
})
