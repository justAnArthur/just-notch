import { describe, expect, test } from 'bun:test'
import type { FrontWindow, Rect } from '@just-notch/sdk'
import { anchorRefused, neighbor, screenOrder, toScreen } from '../src/displays'
import { place, LAYOUTS } from '../src/layouts'
import { RestoreMemory } from '../src/restore'

// Accessibility space: origin at the main screen's top left, y down. Visible frames (menu bar and Dock out).
const laptop: Rect = { x: 0, y: 25, w: 1512, h: 920 }
const portraitRight: Rect = { x: 1512, y: -400, w: 1080, h: 1895 }
const above: Rect = { x: 0, y: -1415, w: 2560, h: 1415 }
const left: Rect = { x: -1920, y: 0, w: 1920, h: 1055 }

describe('screen order', () => {
  test('left to right, whatever order the system lists them in', () => {
    expect(screenOrder([laptop, portraitRight, left])).toEqual([2, 0, 1])
  })

  test('a display stacked above the laptop comes before it', () => {
    expect(screenOrder([laptop, above])).toEqual([1, 0])
    expect(neighbor([laptop, above], 0, 1)).toBe(1)
    expect(neighbor([laptop, above], 1, 1)).toBe(0)
  })

  test('previous wraps around', () => {
    expect(neighbor([laptop, portraitRight, left], 2, -1)).toBe(1)
  })
})

describe('moving to another screen', () => {
  test('a left half stays a left half on a portrait display', () => {
    const half = { x: 0, y: 25, w: 756, h: 920 }
    expect(toScreen(half, laptop, portraitRight)).toEqual({ x: 1512, y: -400, w: 540, h: 1895 })
  })

  test('relative size and place are kept', () => {
    const win = { x: 378, y: 255, w: 756, h: 460 }
    expect(toScreen(win, laptop, above)).toEqual({ x: 640, y: -1061, w: 1280, h: 707 })
  })

  test('a window hanging off its screen lands inside the next one', () => {
    const r = toScreen({ x: 1200, y: 25, w: 900, h: 920 }, laptop, portraitRight)
    expect(r.x).toBeGreaterThanOrEqual(portraitRight.x)
    expect(r.x + r.w).toBeLessThanOrEqual(portraitRight.x + portraitRight.w)
  })

  test('Next Display through place() uses spatial order', () => {
    const next = LAYOUTS.find((l) => l.id === 'nextDisplay')!
    const win: FrontWindow = { app: 'A', pid: 1, title: 't', frame: { x: 0, y: 25, w: 756, h: 920 }, screen: 0, screens: [laptop, portraitRight, left] }
    expect(place(next, win)!.x).toBe(portraitRight.x)
    expect(place(next, { ...win, frame: { x: -1920, y: 0, w: 960, h: 1055 }, screen: 2 })!.x).toBe(0)
  })
})

describe('minimum sizes', () => {
  test('a right third the app keeps wider stays against the right edge', () => {
    const asked = { x: 1008, y: 25, w: 504, h: 920 }
    expect(anchorRefused(asked, { x: 1008, y: 25, w: 700, h: 920 }, laptop)).toEqual({ x: 812, y: 25, w: 700, h: 920 })
  })

  test('a bottom half the app keeps taller stays against the bottom', () => {
    const asked = { x: 0, y: 485, w: 1512, h: 460 }
    expect(anchorRefused(asked, { x: 0, y: 485, w: 1512, h: 600 }, laptop)).toEqual({ x: 0, y: 345, w: 1512, h: 600 })
  })

  test('a left half keeps its left edge', () => {
    const asked = { x: 0, y: 25, w: 756, h: 920 }
    expect(anchorRefused(asked, { x: 0, y: 25, w: 900, h: 920 }, laptop)).toEqual({ x: 0, y: 25, w: 900, h: 920 })
  })

  test("Terminal's grid rounding is not a refusal", () => {
    const asked = { x: 0, y: 25, w: 756, h: 920 }
    expect(anchorRefused(asked, { x: 0, y: 25, w: 763, h: 925 }, laptop)).toBeUndefined()
  })
})

describe('restore', () => {
  const win = (frame: Rect, title = 'Doc'): FrontWindow => ({ app: 'A', pid: 7, title, frame, screen: 0, screens: [laptop] })
  const start = { x: 200, y: 200, w: 800, h: 600 }
  const half = { x: 0, y: 25, w: 756, h: 920 }
  const third = { x: 0, y: 25, w: 504, h: 920 }

  test('two moves in a row restore to the frame before the first', () => {
    const m = new RestoreMemory()
    m.moved(win(start), half)
    m.moved(win(half), third)
    expect(m.take(win(third))).toEqual(start)
    expect(m.take(win(third))).toBeUndefined()
  })

  test('found by where it was left after its title changed', () => {
    const m = new RestoreMemory()
    m.moved(win(start, 'Tab 1'), half)
    expect(m.take(win(half, 'Tab 2'))).toEqual(start)
  })

  test('two windows of one app each keep their own', () => {
    const m = new RestoreMemory()
    const other = { x: 300, y: 300, w: 500, h: 400 }
    m.moved(win(start, 'One'), half)
    m.moved(win(other, 'Two'), { ...half, x: 756 })
    expect(m.take(win({ ...half, x: 756 }, 'Two'))).toEqual(other)
    expect(m.take(win(half, 'One'))).toEqual(start)
  })

  test('a window the user moved since is remembered afresh', () => {
    const m = new RestoreMemory()
    m.moved(win(start), half)
    const dragged = { x: 400, y: 100, w: 700, h: 500 }
    m.moved(win(dragged), third)
    expect(m.take(win(third))).toEqual(dragged)
  })
})
