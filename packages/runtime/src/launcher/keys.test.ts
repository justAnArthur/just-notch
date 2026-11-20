import { describe, expect, it } from 'vitest'
import { actionKey } from './actions'
import { actionForKey, formatAccelerator, normalizeAccelerator, numberKey } from './shortcut'

const key = (code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  code,
  key: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})
const cmd = (code: string) => key(code, { metaKey: true })

describe('a result action’s own shortcut', () => {
  const clip = [{ shortcut: undefined }, { shortcut: 'Command+.' }, { shortcut: 'cmd+backspace' }, { shortcut: 'Command+K' }, { shortcut: 'Command+1' }]

  it('spells accelerators one way', () => {
    expect(normalizeAccelerator('cmd+backspace')).toBe('Command+Backspace')
    expect(normalizeAccelerator('Shift+Command+p')).toBe('Shift+Command+P')
    expect(normalizeAccelerator('Command+Period')).toBe('Command+.')
  })

  it('finds the action a press runs', () => {
    expect(actionForKey(clip, cmd('Period'))).toBe(1)
    expect(actionForKey(clip, cmd('Backspace'))).toBe(2)
    expect(actionForKey(clip, key('Backspace'))).toBe(-1)
    expect(actionForKey(clip, key('KeyA', { shiftKey: true }))).toBe(-1)
  })

  it('leaves the launcher its own keys', () => {
    expect(actionForKey(clip, cmd('KeyK'))).toBe(-1)
    expect(actionForKey(clip, cmd('Digit1'))).toBe(-1)
    expect(actionForKey([{ shortcut: 'Command+Y' }], cmd('KeyY'))).toBe(-1)
  })

  it('reads ⌘1–⌘9 as a place, and nothing else', () => {
    expect(numberKey(cmd('Digit1'))).toBe(0)
    expect(numberKey(cmd('Digit9'))).toBe(8)
    expect(numberKey(cmd('Digit0'))).toBeUndefined()
    expect(numberKey(key('Digit3'))).toBeUndefined()
    expect(numberKey(key('Digit3', { metaKey: true, shiftKey: true }))).toBeUndefined()
  })

  it('shows in the ⌘K list, after ↩, ⌘↩ and ⇧↩', () => {
    expect(actionKey({}, 0)).toBe('↩')
    expect(actionKey({ shortcut: 'Command+.' }, 3)).toBe('⌘.')
    expect(actionKey({ shortcut: 'Command+Backspace' }, 4)).toBe('⌘⌫')
    expect(actionKey({}, 5)).toBeUndefined()
    expect(formatAccelerator('Command+Backspace')).toBe('⌘⌫')
  })
})
