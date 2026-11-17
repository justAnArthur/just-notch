import type { Rect, ScreenGeometry } from '@just-notch/bridge-schema'
import type { IslandState } from '@just-notch/sdk'

/** The island's outline: a body of `w` × `h` hanging from the top edge, `radius` below, concave `shoulder`s into the edge. */
export interface Shape {
  w: number
  h: number
  radius: number
  shoulder: number
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** The open panel the notch kit's widgets are laid out for; its first snap fits the content up to `h`. */
const EXPANDED = { w: 720, h: 240 }
/** The tall snap, for settings and any tab pulled down. */
const SHEET_H = 560
/** The least the first snap shrinks to. */
const FIT_MIN = 140
/** The open island's height around its content: the tab row (the notch's height), the title (h-6), the gap above the content (pt-2) and the bottom inset (pb-5, as the sides). */
export const chromeHeight = (g: ScreenGeometry) => g.notch.h + 24 + 8 + 20

/** How tall the open island is: on the first snap it fits `content`, on the second it is the tall sheet. */
export interface Sheet {
  snap: 0 | 1
  /** The content's own height; unknown until measured. */
  content?: number
}
/** Room for one compact slot beside the notch: about as wide as the notch is tall. */
export const slotWidth = (g: ScreenGeometry) => g.notch.h + 8

/** The expanded island's one content inset (px-5): header, title and content all start here, clear of the bottom corners. */
export const INSET = 20
/** An icon tab's width (w-7.5): a compact control's height plus the icon's breathing room. */
export const TAB_W = 30
/** Kept free on each side of the notch. */
const NOTCH_GAP = 8
/** The settings button (size-7) and its gap, at the far right of the header. */
const GEAR_W = 32

export interface StripLayout {
  /** Tabs in the left wing; the rest follow in the right one. */
  before: number
  /** More tabs than both wings hold: the strip scrolls (behind the notch). */
  overflow: boolean
  /** The notch and its gaps in the strip's coordinates (it starts at the inset). */
  hole: { start: number; end: number }
  /** Least width of the gap between the wings, so the right wing starts past the notch. */
  spacer: number
}

/** Tabs flow from the left wing into the right one, balanced, each wing filling from its outer edge. */
export function stripLayout(count: number, w: number, g: ScreenGeometry): StripLayout {
  const side = (w - g.notch.w) / 2
  const left = side - INSET - NOTCH_GAP
  const leftCap = Math.floor(left / TAB_W)
  const rightCap = Math.floor((left - GEAR_W) / TAB_W)
  const overflow = count > leftCap + rightCap
  const before = overflow ? leftCap : Math.min(leftCap, Math.max(Math.ceil(count / 2), count - rightCap))
  const hole = { start: left, end: side + g.notch.w + NOTCH_GAP - INSET }
  return { before, overflow, hole, spacer: hole.end - before * TAB_W }
}

export function shapeFor(state: IslandState, g: ScreenGeometry, sheet: Sheet = { snap: 0 }): Shape {
  const { notch, panel } = g
  const slot = slotWidth(g)
  if (state === 'idle') return { w: notch.w, h: notch.h, radius: 10, shoulder: 6 }
  if (state === 'compact' || state === 'split') return { w: notch.w + 2 * slot, h: notch.h, radius: 13, shoulder: 8 }
  if (state === 'flash') return { w: notch.w + 2 * (slot + 64), h: notch.h + 48, radius: 24, shoulder: 10 }
  const room = panel.h - 24
  const fit = sheet.content === undefined ? EXPANDED.h : Math.max(FIT_MIN, Math.min(EXPANDED.h, Math.ceil(sheet.content + chromeHeight(g))))
  const h = sheet.snap === 1 ? Math.min(SHEET_H, room) : Math.min(fit, room)
  return { w: Math.min(EXPANDED.w, panel.w - 28), h, radius: 32, shoulder: 14 }
}

/** The detached bubble of `split`: a circle as tall as the compact island, its center `x` from the island's center. */
export function bubbleFor(shape: Shape, g: ScreenGeometry, detached: boolean) {
  const r = g.notch.h / 2 - 1
  return detached ? { x: shape.w / 2 + shape.shoulder + 14 + r, r } : { x: shape.w / 2 - r, r: r * 0.5 }
}

export const centerX = (g: ScreenGeometry) => g.notch.x + g.notch.w / 2

export function boxOf(shape: Shape, g: ScreenGeometry): Box {
  return { left: centerX(g) - shape.w / 2, top: 0, width: shape.w, height: shape.h }
}

export function rectOf(shape: Shape, g: ScreenGeometry): Rect {
  return { x: centerX(g) - shape.w / 2 - shape.shoulder, y: 0, w: shape.w + 2 * shape.shoulder, h: shape.h }
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

// A circle's quarter as a cubic has handles at 0.5523 of the radius. Stretching
// the corner over 1.28 r with longer handles spreads the curvature like Apple's
// continuous corners, so the bottom never reads as a plain rounded rectangle.
const CIRCLE = 0.5523
const SMOOTH_SPAN = 1.28
const SMOOTH_HANDLE = 0.64

/**
 * The outline as one path in panel coordinates. It starts a point above the
 * top edge so no hairline shows where it meets the screen.
 */
export function islandPath(cx: number, { w, h, radius, shoulder }: Shape): string {
  const s = Math.max(0, Math.min(shoulder, h / 2))
  const span = Math.max(0, Math.min(radius * SMOOTH_SPAN, h - s, w / 2))
  const k = span * (1 - SMOOTH_HANDLE)
  const q = s * (1 - CIRCLE)
  const l = cx - w / 2
  const r = cx + w / 2
  return [
    `M${l - s} -1`,
    `L${l - s} 0`,
    `C${l - q} 0 ${l} ${q} ${l} ${s}`,
    `L${l} ${h - span}`,
    `C${l} ${h - k} ${l + k} ${h} ${l + span} ${h}`,
    `L${r - span} ${h}`,
    `C${r - k} ${h} ${r} ${h - k} ${r} ${h - span}`,
    `L${r} ${s}`,
    `C${r} ${q} ${r + q} 0 ${r + s} 0`,
    `L${r + s} -1`,
    'Z',
  ].join('')
}
