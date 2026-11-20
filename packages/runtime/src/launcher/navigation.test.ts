import { describe, expect, it } from 'vitest'
import { moveOf, moveTo, recall } from './navigation'

const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({ key: k, code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })
const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }))
/** Sections of 1, 3 and 2 rows: a | b c d | e f. */
const sizes = [1, 3, 2]
const at = (id: string) => ({ id, index: rows.findIndex((r) => r.id === id) })

describe('keys', () => {
  it('moves by one row with the arrows and Emacs keys', () => {
    expect(moveOf(key('ArrowDown'))).toEqual({ step: 1 })
    expect(moveOf(key('n', { ctrlKey: true }))).toEqual({ step: 1 })
    expect(moveOf(key('j', { ctrlKey: true }))).toEqual({ step: 1 })
    expect(moveOf(key('p', { ctrlKey: true }))).toEqual({ step: -1 })
    expect(moveOf(key('k', { ctrlKey: true }))).toEqual({ step: -1 })
  })

  it('jumps by section, to the ends and by page', () => {
    expect(moveOf(key('ArrowDown', { metaKey: true }))).toEqual({ section: 1 })
    expect(moveOf(key('Home'))).toEqual({ to: 'first' })
    expect(moveOf(key('PageUp'))).toEqual({ page: -1 })
    expect(moveOf(key('k', { metaKey: true }))).toBeUndefined()
    expect(moveOf(key('ArrowDown', { shiftKey: true }))).toBeUndefined()
  })
})

describe('moves', () => {
  it('wraps by row and stops at the ends by page', () => {
    expect(moveTo(rows, sizes, at('f'), { step: 1 })?.id).toBe('a')
    expect(moveTo(rows, sizes, at('b'), { page: 1 })?.id).toBe('f')
    expect(moveTo(rows, sizes, at('b'), { to: 'last' })?.id).toBe('f')
  })

  it('jumps to the next section’s first row, and back to this one’s start', () => {
    expect(moveTo(rows, sizes, undefined, { section: 1 })?.id).toBe('b')
    expect(moveTo(rows, sizes, at('c'), { section: 1 })?.id).toBe('e')
    expect(moveTo(rows, sizes, at('f'), { section: 1 })?.id).toBe('a')
    expect(moveTo(rows, sizes, at('d'), { section: -1 })?.id).toBe('b')
    expect(moveTo(rows, sizes, at('a'), { section: -1 })?.id).toBe('e')
  })
})

describe('history', () => {
  it('steps back from the newest and forward to nothing', () => {
    expect(recall(['saf', 'term'], undefined, 1)).toBe(0)
    expect(recall(['saf', 'term'], 0, 1)).toBe(1)
    expect(recall(['saf', 'term'], 1, 1)).toBe(1)
    expect(recall(['saf', 'term'], 0, -1)).toBeUndefined()
    expect(recall([], undefined, 1)).toBeUndefined()
  })
})
