import { describe, expect, it } from 'vitest'
import { matchActions, shownAnswer } from './providers'

describe('stable results', () => {
  it('keeps the last answer while the next loads, and shows nothing once off', () => {
    const latest = { key: 'files rea', value: ['README.md'] }
    expect(shownAnswer(latest, true)).toEqual(['README.md'])
    expect(shownAnswer(latest, false)).toBeUndefined()
    expect(shownAnswer(undefined, true)).toBeUndefined()
  })
})

describe('root ranking', () => {
  const shortcuts = ['Start Pomodoro', 'Translate Clipboard', 'Morning Summary', 'Copy Timestamp', 'Resize Images']
  const titles = (query: string, root = true) => matchActions(query, root, shortcuts, {}).map((m) => m.title)

  it('keeps scattered letters out of the root', () => {
    expect(titles('term')).toEqual([])
    expect(titles('rea')).toEqual([])
    expect(titles('ss')).not.toContain('Resize Images')
  })

  it('still finds them inside the Actions scope', () => {
    expect(titles('term', false)).toContain('Toggle Dark Mode')
  })

  it('finds close matches in the root, by name or keyword', () => {
    expect(titles('slee')[0]).toBe('Sleep')
    expect(titles('dark')[0]).toBe('Toggle Dark Mode')
    expect(titles('pomo')).toEqual(['Start Pomodoro'])
  })

  it('no longer runs Turn Off Display for "lock"', () => {
    expect(titles('lock')).not.toContain('Turn Off Display')
  })
})
