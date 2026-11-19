import type { FrontWindow, Rect } from '@just-notch/sdk'

/** A part of the screen, as fractions of its visible frame. */
type Part = { x: number; y: number; w: number; h: number }

type Op = 'center' | 'moveLeft' | 'moveRight' | 'moveUp' | 'moveDown' | 'nextDisplay' | 'previousDisplay' | 'larger' | 'smaller' | 'maximizeHeight' | 'maximizeWidth' | 'restore'

export interface Layout {
  id: string
  title: string
  /** More words it's found by: `left` finds the first third. */
  keywords?: string[]
  part?: Part
  op?: Op
}

const T = 1 / 3

const part = (id: string, title: string, x: number, y: number, w: number, h: number, keywords?: string[]): Layout => ({ id, title, part: { x, y, w, h }, keywords })
const op = (id: Op, title: string, keywords?: string[]): Layout => ({ id, title, op: id, keywords })

/** Every layout, in the order the scope lists them. */
export const LAYOUTS: Layout[] = [
  part('left-half', 'Left Half', 0, 0, 0.5, 1),
  part('right-half', 'Right Half', 0.5, 0, 0.5, 1),
  part('center-half', 'Center Half', 0.25, 0, 0.5, 1),
  part('top-half', 'Top Half', 0, 0, 1, 0.5),
  part('bottom-half', 'Bottom Half', 0, 0.5, 1, 0.5),
  part('top-left-quarter', 'Top Left Quarter', 0, 0, 0.5, 0.5),
  part('top-right-quarter', 'Top Right Quarter', 0.5, 0, 0.5, 0.5),
  part('bottom-left-quarter', 'Bottom Left Quarter', 0, 0.5, 0.5, 0.5),
  part('bottom-right-quarter', 'Bottom Right Quarter', 0.5, 0.5, 0.5, 0.5),
  part('first-third', 'First Third', 0, 0, T, 1, ['left']),
  part('center-third', 'Center Third', T, 0, T, 1, ['middle']),
  part('last-third', 'Last Third', 2 * T, 0, T, 1, ['right']),
  part('first-two-thirds', 'First Two Thirds', 0, 0, 2 * T, 1, ['left']),
  part('center-two-thirds', 'Center Two Thirds', T / 2, 0, 2 * T, 1, ['middle']),
  part('last-two-thirds', 'Last Two Thirds', T, 0, 2 * T, 1, ['right']),
  part('first-fourth', 'First Fourth', 0, 0, 0.25, 1, ['left', 'quarter']),
  part('second-fourth', 'Second Fourth', 0.25, 0, 0.25, 1, ['quarter']),
  part('third-fourth', 'Third Fourth', 0.5, 0, 0.25, 1, ['quarter']),
  part('last-fourth', 'Last Fourth', 0.75, 0, 0.25, 1, ['right', 'quarter']),
  part('first-three-fourths', 'First Three Fourths', 0, 0, 0.75, 1, ['left']),
  part('last-three-fourths', 'Last Three Fourths', 0.25, 0, 0.75, 1, ['right']),
  part('top-left-sixth', 'Top Left Sixth', 0, 0, T, 0.5),
  part('top-center-sixth', 'Top Center Sixth', T, 0, T, 0.5),
  part('top-right-sixth', 'Top Right Sixth', 2 * T, 0, T, 0.5),
  part('bottom-left-sixth', 'Bottom Left Sixth', 0, 0.5, T, 0.5),
  part('bottom-center-sixth', 'Bottom Center Sixth', T, 0.5, T, 0.5),
  part('bottom-right-sixth', 'Bottom Right Sixth', 2 * T, 0.5, T, 0.5),
  part('maximize', 'Maximize', 0, 0, 1, 1, ['full', 'fill']),
  part('almost-maximize', 'Almost Maximize', 0.05, 0.05, 0.9, 0.9, ['full']),
  op('maximizeHeight', 'Maximize Height', ['full', 'vertical']),
  op('maximizeWidth', 'Maximize Width', ['full', 'horizontal']),
  op('center', 'Center', ['middle']),
  op('moveLeft', 'Move Left', ['edge']),
  op('moveRight', 'Move Right', ['edge']),
  op('moveUp', 'Move Up', ['top', 'edge']),
  op('moveDown', 'Move Down', ['bottom', 'edge']),
  op('nextDisplay', 'Next Display', ['screen', 'monitor']),
  op('previousDisplay', 'Previous Display', ['screen', 'monitor']),
  op('larger', 'Make Larger', ['bigger', 'grow']),
  op('smaller', 'Make Smaller', ['shrink']),
  op('restore', 'Restore', ['undo', 'original']),
]

/** The layouts every word of `query` starts a word of, those whose title starts with it first. */
export function findLayouts(query: string): Layout[] {
  const q = query.toLowerCase().trim()
  const words = q.split(/\s+/).filter(Boolean)
  if (!words.length) return LAYOUTS
  const found = LAYOUTS.filter((l) => {
    const own = `${l.title} ${l.keywords?.join(' ') ?? ''}`.toLowerCase().split(/\s+/)
    return words.every((w) => own.some((o) => o.startsWith(w)))
  })
  const first = (l: Layout) => (l.title.toLowerCase().startsWith(q) ? 0 : 1)
  return found.sort((a, b) => first(a) - first(b))
}

/** Grows or shrinks by this much of the screen on each side. */
const STEP = 0.05
const MIN_W = 240
const MIN_H = 160

const clamp = (r: Rect, s: Rect): Rect => {
  const w = Math.min(r.w, s.w)
  const h = Math.min(r.h, s.h)
  return { x: Math.min(Math.max(r.x, s.x), s.x + s.w - w), y: Math.min(Math.max(r.y, s.y), s.y + s.h - h), w, h }
}

/** Where `layout` puts the window; `undefined` for `restore`, which the plugin answers from what it remembers. */
export function place(layout: Layout, win: FrontWindow): Rect | undefined {
  const s = win.screens[win.screen] ?? win.screens[0]
  const f = win.frame
  if (!s) return undefined
  if (layout.part) {
    const p = layout.part
    // Rounded, so two halves meet without a gap or an overlap.
    const x = Math.round(s.x + p.x * s.w)
    const y = Math.round(s.y + p.y * s.h)
    return { x, y, w: Math.round(s.x + (p.x + p.w) * s.w) - x, h: Math.round(s.y + (p.y + p.h) * s.h) - y }
  }
  switch (layout.op) {
    case 'center':
      return clamp({ ...f, x: Math.round(s.x + (s.w - f.w) / 2), y: Math.round(s.y + (s.h - f.h) / 2) }, s)
    case 'maximizeHeight':
      return { ...f, y: s.y, h: s.h }
    case 'maximizeWidth':
      return { ...f, x: s.x, w: s.w }
    case 'moveLeft':
      return clamp({ ...f, x: s.x }, s)
    case 'moveRight':
      return clamp({ ...f, x: s.x + s.w - f.w }, s)
    case 'moveUp':
      return clamp({ ...f, y: s.y }, s)
    case 'moveDown':
      return clamp({ ...f, y: s.y + s.h - f.h }, s)
    case 'larger':
    case 'smaller': {
      const sign = layout.op === 'larger' ? 1 : -1
      const dx = sign * Math.round(s.w * STEP)
      const dy = sign * Math.round(s.h * STEP)
      const w = Math.max(f.w + 2 * dx, MIN_W)
      const h = Math.max(f.h + 2 * dy, MIN_H)
      return clamp({ x: f.x - (w - f.w) / 2, y: f.y - (h - f.h) / 2, w, h }, s)
    }
    case 'nextDisplay':
    case 'previousDisplay': {
      const n = win.screens.length
      if (n < 2) return undefined
      const to = win.screens[(win.screen + (layout.op === 'nextDisplay' ? 1 : n - 1)) % n]!
      const sx = to.w / s.w
      const sy = to.h / s.h
      return clamp({ x: Math.round(to.x + (f.x - s.x) * sx), y: Math.round(to.y + (f.y - s.y) * sy), w: Math.round(f.w * sx), h: Math.round(f.h * sy) }, to)
    }
  }
  return undefined
}

const BLUE = '#3b82f6'

/** A layout's icon: the screen in blue, the part it takes in white, or a glyph for the moves. */
export function icon(layout: Layout): string {
  const S = 28
  const pad = 5
  const inner = S - 2 * pad
  let body = ''
  if (layout.part) {
    const p = layout.part
    const g = 1.5
    body = `<rect x="${pad + p.x * inner + g / 2}" y="${pad + p.y * inner + g / 2}" width="${p.w * inner - g}" height="${p.h * inner - g}" rx="2" fill="white"/>`
  } else {
    const line = (d: string) => `<path d="${d}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    body =
      {
        center: `<rect x="9" y="10" width="10" height="8" rx="1.5" fill="white"/>`,
        maximizeHeight: line('M14 6v16M11 9l3-3 3 3M11 19l3 3 3-3'),
        maximizeWidth: line('M6 14h16M9 11l-3 3 3 3M19 11l3 3-3 3'),
        moveLeft: line('M20 14H8M12 10l-4 4 4 4'),
        moveRight: line('M8 14h12M16 10l4 4-4 4'),
        moveUp: line('M14 20V8M10 12l4-4 4 4'),
        moveDown: line('M14 8v12M10 16l4 4 4-4'),
        nextDisplay: `<rect x="5" y="9" width="8" height="7" rx="1" fill="white" opacity=".5"/><rect x="15" y="9" width="8" height="7" rx="1" fill="white"/>${line('M10 20h8M16 18l2 2-2 2')}`,
        previousDisplay: `<rect x="5" y="9" width="8" height="7" rx="1" fill="white"/><rect x="15" y="9" width="8" height="7" rx="1" fill="white" opacity=".5"/>${line('M18 20h-8M12 18l-2 2 2 2')}`,
        larger: line('M8 14h12M14 8v12'),
        smaller: line('M8 14h12'),
        restore: line('M9 11a6 6 0 1 1-1 5M9 6v5h5'),
      }[layout.op!] ?? ''
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="7" fill="${BLUE}"/>${body}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
