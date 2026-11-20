import { describe, expect, it } from 'vitest'
import { moveSelection, selectedIndex } from './selection'

const rows = (...ids: string[]) => ids.map((id) => ({ id }))

describe('selection', () => {
  it('selects the first row until the user moves', () => {
    expect(selectedIndex(rows('a', 'b'), undefined)).toBe(0)
    expect(selectedIndex(rows('late', 'a', 'b'), undefined)).toBe(0)
  })

  it('follows the selected row when late rows land above it', () => {
    const web = moveSelection(rows('app', 'web'), undefined, -1)
    expect(web).toEqual({ id: 'web', index: 1 })
    expect(selectedIndex(rows('app', 'file:readme', 'web'), web)).toBe(2)
  })

  it('stays about where it was when its row goes away', () => {
    expect(selectedIndex(rows('a', 'b', 'c'), { id: 'gone', index: 1 })).toBe(1)
    expect(selectedIndex(rows('a'), { id: 'gone', index: 4 })).toBe(0)
  })

  it('moves from the row, not from the index, and wraps', () => {
    expect(moveSelection(rows('new', 'a', 'b'), { id: 'a', index: 0 }, 1)).toEqual({ id: 'b', index: 2 })
    expect(moveSelection(rows('a', 'b'), { id: 'b', index: 1 }, 1)).toEqual({ id: 'a', index: 0 })
    expect(moveSelection([], undefined, 1)).toBeUndefined()
  })
})
