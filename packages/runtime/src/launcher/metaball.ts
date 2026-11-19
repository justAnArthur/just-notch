/**
 * The liquid bridge between two circles, as one SVG path: two tangent curves that pinch in as the circles part
 * and vanish past `reach`. Drawn with the circles in the same fill, it reads as one body of liquid; no blur
 * filter, so it stays sharp and costs a path per frame.
 *
 * After Hiroyuki Sato's metaball construction (as in Varun Vachhar's SVG metaballs).
 */
export interface Circle {
  x: number
  y: number
  r: number
}

const HANDLE = 2.4

/**
 * `reach` is how far apart the centres may get, in multiples of the smaller radius past touching, before the
 * bridge snaps; `spread` (0–1) how far round each circle it starts: higher, a fatter neck.
 */
export function bridgePath(a: Circle, b: Circle, reach = 2.5, spread = 0.5): string {
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  const [big, small] = a.r >= b.r ? [a, b] : [b, a]
  if (small.r <= 0.5 || d > big.r + small.r + small.r * reach || d <= big.r - small.r) return ''
  const r1 = a.r
  const r2 = b.r

  let u1 = 0
  let u2 = 0
  if (d < r1 + r2) {
    u1 = Math.acos(clamp((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d)))
    u2 = Math.acos(clamp((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d)))
  }
  const between = Math.atan2(b.y - a.y, b.x - a.x)
  const maxSpread = Math.acos(clamp((r1 - r2) / d))

  const a1 = between + u1 + (maxSpread - u1) * spread
  const a2 = between - u1 - (maxSpread - u1) * spread
  const a3 = between + Math.PI - u2 - (Math.PI - u2 - maxSpread) * spread
  const a4 = between - Math.PI + u2 + (Math.PI - u2 - maxSpread) * spread

  const p1 = at(a, a1, r1)
  const p2 = at(a, a2, r1)
  const p3 = at(b, a3, r2)
  const p4 = at(b, a4, r2)

  // Handles shorten as the circles part, so the neck thins before it snaps.
  const base = Math.min(spread * HANDLE, Math.hypot(p1.x - p3.x, p1.y - p3.y) / (r1 + r2))
  const k = base * Math.min(1, (d * 2) / (r1 + r2))
  const h1 = at(p1, a1 - Math.PI / 2, r1 * k)
  const h2 = at(p2, a2 + Math.PI / 2, r1 * k)
  const h3 = at(p3, a3 + Math.PI / 2, r2 * k)
  const h4 = at(p4, a4 - Math.PI / 2, r2 * k)

  return `M${f(p1)}C${f(h1)} ${f(h3)} ${f(p3)}L${f(p4)}C${f(h4)} ${f(h2)} ${f(p2)}Z`
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v))
const at = (c: { x: number; y: number }, angle: number, r: number) => ({ x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) })
const f = (p: { x: number; y: number }) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`
