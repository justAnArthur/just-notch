import { describe, expect, test } from 'bun:test'
import { bindings, COMMANDS, cycleStep, type LastMove } from '../src/commands'
import { place } from '../src/layouts'
import { normalize, reservedBy } from '../src/shortcut'

const screen = { x: 0, y: 25, w: 1440, h: 875 }
const win = (frame = { x: 300, y: 200, w: 800, h: 600 }) => ({ app: 'Notes', pid: 1, title: 'A', frame, screen: 0, screens: [screen] })
const cmd = (id: string) => COMMANDS.find((c) => c.id === id)!

/** Presses `id` `n` times on a window that goes where it's put; the widths it lands at. */
function presses(id: string, n: number, cycling = true) {
  let last: LastMove | undefined
  let frame = win().frame
  const widths: number[] = []
  for (let i = 0; i < n; i++) {
    const step = cycleStep(last, cmd(id), '1:A', frame, cycling)
    frame = place(cmd(id).cycle[step]!, win(frame))!
    last = { command: id, window: '1:A', step, frame }
    widths.push(frame.w)
  }
  return widths
}

describe('cycling', () => {
  test('⌃⌥← three times: 1/2 → 2/3 → 1/3, then back to 1/2', () => {
    expect(presses('left-half', 4)).toEqual([720, 960, 480, 720])
  })

  test('right half keeps to the right edge', () => {
    let last: LastMove | undefined
    let frame = win().frame
    for (const w of [720, 960, 480]) {
      const step = cycleStep(last, cmd('right-half'), '1:A', frame, true)
      frame = place(cmd('right-half').cycle[step]!, win(frame))!
      last = { command: 'right-half', window: '1:A', step, frame }
      expect(frame.w).toBe(w)
      expect(frame.x + frame.w).toBe(1440)
    }
  })

  test('top half cycles heights', () => {
    let last: LastMove | undefined
    let frame = win().frame
    const heights: number[] = []
    for (let i = 0; i < 3; i++) {
      const step = cycleStep(last, cmd('top-half'), '1:A', frame, true)
      frame = place(cmd('top-half').cycle[step]!, win(frame))!
      last = { command: 'top-half', window: '1:A', step, frame }
      heights.push(frame.h)
    }
    expect(heights).toEqual([438, 583, 292])
  })

  test('first third steps along: first → center → last', () => {
    expect(cmd('first-third').cycle.map((l) => l.id)).toEqual(['first-third', 'center-third', 'last-third'])
    expect(cmd('last-third').cycle.map((l) => l.id)).toEqual(['last-third', 'center-third', 'first-third'])
  })

  test('off: every press is the half', () => {
    expect(presses('left-half', 3, false)).toEqual([720, 720, 720])
  })

  const last: LastMove = { command: 'left-half', window: '1:A', step: 0, frame: { x: 0, y: 25, w: 720, h: 875 } }

  test('another command starts over', () => {
    expect(cycleStep(last, cmd('right-half'), '1:A', last.frame, true)).toBe(0)
  })

  test('another window starts over', () => {
    expect(cycleStep(last, cmd('left-half'), '2:B', last.frame, true)).toBe(0)
  })

  test('a window moved since starts over', () => {
    expect(cycleStep(last, cmd('left-half'), '1:A', { ...last.frame, x: 100 }, true)).toBe(0)
  })

  test('a size the app rounded still counts as in place', () => {
    expect(cycleStep(last, cmd('left-half'), '1:A', { ...last.frame, w: 713, h: 870 }, true)).toBe(1)
  })

  test('commands without a cycle stay put', () => {
    expect(cycleStep({ ...last, command: 'maximize' }, cmd('maximize'), '1:A', last.frame, true)).toBe(0)
  })
})

describe('bindings', () => {
  test('the ⌃⌥ defaults have no duplicates', () => {
    const all = COMMANDS.map((c) => normalize(c.accelerator))
    expect(new Set(all).size).toBe(all.length)
    expect(all.every((a) => !reservedBy(a))).toBe(true)
  })

  test('an override wins, null turns a command off', () => {
    const b = bindings({ 'left-half': 'Control+Alt+H', maximize: null })
    expect(b.get('left-half')).toBe('Control+Alt+H')
    expect(b.get('maximize')).toBeNull()
    expect(b.get('right-half')).toBe('Control+Alt+Right')
  })

  test('spellings compare equal', () => {
    expect(normalize('option+ctrl+left')).toBe(normalize('Control+Alt+Left'))
    expect(reservedBy('ctrl+left')).toBe('Mission Control (previous Space)')
  })
})
