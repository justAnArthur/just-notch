import { describe, expect, it } from 'vitest'
import { filterActions, panelHeight } from './actions'

const action = (title: string) => ({ title, run: () => {} })
const actions = [action('Open'), action('Show in Finder'), action('Copy Path')]

describe('filterActions', () => {
  it('lists every action in order when nothing is typed', () => {
    expect(filterActions(actions, '  ').map((a) => a.index)).toEqual([0, 1, 2])
  })

  it('keeps matching actions with their place in the row', () => {
    const listed = filterActions(actions, 'copy')
    expect(listed.map((a) => [a.action.title, a.index])).toEqual([['Copy Path', 2]])
  })

  it('lists nothing when no action matches', () => {
    expect(filterActions(actions, 'zzz')).toEqual([])
  })
})

describe('panelHeight', () => {
  it('keeps room for one line when nothing matches', () => {
    expect(panelHeight(0)).toBe(panelHeight(1))
    expect(panelHeight(3)).toBeGreaterThan(panelHeight(1))
  })
})
