import type { Rect } from '@just-notch/sdk'

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Whether two screens share most of a column: one sits above the other. */
const stacked = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > Math.min(a.w, b.w) / 2

/**
 * The screens' indices in the order Next Display walks them: left to right, and top to bottom for screens stacked
 * in one column (a display above the laptop). `screens` comes in the system's order, main first.
 */
export function screenOrder(screens: Rect[]): number[] {
  return screens
    .map((_, i) => i)
    .sort((i, j) => {
      const a = screens[i]!
      const b = screens[j]!
      return stacked(a, b) ? center(a).y - center(b).y : center(a).x - center(b).x
    })
}

/** The screen after (`step` 1) or before (`step` -1) `current` in `screenOrder`, wrapping around. */
export function neighbor(screens: Rect[], current: number, step: 1 | -1): number {
  const order = screenOrder(screens)
  const at = order.indexOf(current)
  return order[(at + step + order.length) % order.length]!
}

export const clampTo = (r: Rect, s: Rect): Rect => {
  const w = Math.min(r.w, s.w)
  const h = Math.min(r.h, s.h)
  return { x: Math.min(Math.max(r.x, s.x), s.x + s.w - w), y: Math.min(Math.max(r.y, s.y), s.y + s.h - h), w, h }
}

/**
 * `frame` moved from screen `from` to `to`, keeping its place and size as fractions of the screen: a left half stays
 * a left half on a portrait display. Edges are rounded from fractions, so a window flush with an edge stays flush.
 */
export function toScreen(frame: Rect, from: Rect, to: Rect): Rect {
  const f = clampTo(frame, from)
  const left = (f.x - from.x) / from.w
  const top = (f.y - from.y) / from.h
  const right = (f.x + f.w - from.x) / from.w
  const bottom = (f.y + f.h - from.y) / from.h
  const x = Math.round(to.x + left * to.w)
  const y = Math.round(to.y + top * to.h)
  return clampTo({ x, y, w: Math.round(to.x + right * to.w) - x, h: Math.round(to.y + bottom * to.h) - y }, to)
}

const SLACK = 16

/**
 * When an app kept its window larger than `asked` (a minimum size), where it should go instead: still against the
 * screen edges the asked frame touched, and on the screen. `undefined` when the app took the size, give or take
 * the few points apps such as Terminal round to their character grid.
 */
export function anchorRefused(asked: Rect, actual: Rect, screen: Rect): Rect | undefined {
  if (actual.w <= asked.w + SLACK && actual.h <= asked.h + SLACK) return undefined
  const right = asked.x + asked.w >= screen.x + screen.w - 2 && asked.x > screen.x + 2
  const bottom = asked.y + asked.h >= screen.y + screen.h - 2 && asked.y > screen.y + 2
  const x = right ? asked.x + asked.w - actual.w : asked.x
  const y = bottom ? asked.y + asked.h - actual.h : asked.y
  return clampTo({ x, y, w: actual.w, h: actual.h }, screen)
}

/** The screen holding most of `r`. */
export function screenOf(r: Rect, screens: Rect[]): Rect | undefined {
  const area = (s: Rect) => Math.max(0, Math.min(r.x + r.w, s.x + s.w) - Math.max(r.x, s.x)) * Math.max(0, Math.min(r.y + r.h, s.y + s.h) - Math.max(r.y, s.y))
  return screens.reduce<Rect | undefined>((best, s) => (!best || area(s) > area(best) ? s : best), undefined)
}
