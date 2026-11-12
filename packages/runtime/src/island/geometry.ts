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

const EXPANDED = { w: 640, h: 200 }
/** Room for one compact slot beside the notch: about as wide as the notch is tall. */
export const slotWidth = (g: ScreenGeometry) => g.notch.h + 8

export function shapeFor(state: IslandState, g: ScreenGeometry): Shape {
  const { notch, panel } = g
  const slot = slotWidth(g)
  if (state === 'idle') return { w: notch.w, h: notch.h, radius: 10, shoulder: 6 }
  if (state === 'compact' || state === 'split') return { w: notch.w + 2 * slot, h: notch.h, radius: 13, shoulder: 8 }
  if (state === 'flash') return { w: notch.w + 2 * (slot + 64), h: notch.h + 48, radius: 24, shoulder: 10 }
  return { w: Math.min(EXPANDED.w, panel.w - 48), h: Math.min(EXPANDED.h, panel.h - 24), radius: 32, shoulder: 14 }
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
