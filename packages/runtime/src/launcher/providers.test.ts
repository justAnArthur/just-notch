import { describe, expect, it } from 'vitest'
import { actionKey } from './actions'
import { answerActions, matchActions } from './providers'

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

  it('locks the screen for "lock", not Turn Off Display', () => {
    expect(titles('lock')).toEqual(['Lock Screen'])
  })

  it('offers restart, shut down and log out, and quits the app in front by name', () => {
    expect(titles('rest')[0]).toBe('Restart…')
    expect(titles('shut')[0]).toBe('Shut Down…')
    expect(titles('log out')[0]).toBe('Log Out…')
    expect(matchActions('quit', true, [], {}, 'Safari').map((m) => m.title)).toEqual(['Quit Safari'])
    expect(matchActions('quit saf', true, [], {}, 'Safari').map((m) => m.title)).toEqual(['Quit Safari'])
    expect(titles('quit')).toEqual([])
  })
})

describe('answer actions', () => {
  const answer = { kind: 'math' as const, expression: '15% of 80', result: '12', copy: '12' }

  it('copies on ↩ and ⌘C, pastes on ⌘↩, copies the expression on ⌥↩', () => {
    const actions = answerActions(answer, () => {})
    expect(actions.map((a) => [a.title, actionKey(a, actions.indexOf(a))])).toEqual([
      ['Copy', '↩'],
      ['Paste', '⌘↩'],
      ['Copy Expression', '⌥↩'],
    ])
    expect(actions[0].shortcut).toBe('Command+C')
  })
})
