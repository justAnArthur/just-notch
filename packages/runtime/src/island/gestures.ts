import { type RefObject, useEffect, useRef } from 'react'

/** A gap this long between wheel events ends a gesture; a flick's momentum runs on without one. */
const QUIET_MS = 160
/** Travel before a gesture picks its axis. */
const LOCK_PX = 8
/** Travel along the axis that commits a swipe. */
export const COMMIT_PX = 40

/** Which way the fingers moved. */
export type Swipe = 'up' | 'down' | 'left' | 'right'

/** One wheel event as finger travel in px: x to the right, y down, whatever the scroll direction setting. */
export interface Sample {
  t: number
  x: number
  y: number
}

export interface Gesture {
  last: number
  x: number
  y: number
  axis?: 'x' | 'y'
  /** `tracking` until it commits a swipe, or a scroller under the pointer or the tab strip takes it. */
  owner: 'tracking' | 'committed' | 'scroller' | 'strip'
  /** Event sizes since the start or the commit: a push after the momentum died down starts a new gesture. */
  peak: number
  floor: number
  /** The committed swipe: only a push the same way can start the next gesture without a quiet gap. */
  swipe?: Swipe
  /** The host's touch count at the commit (in the app). */
  touch?: number
}

const directionOf = (s: Sample): Swipe => (Math.abs(s.x) > Math.abs(s.y) ? (s.x > 0 ? 'right' : 'left') : s.y > 0 ? 'down' : 'up')

/**
 * Whether `s` starts a new gesture: after a quiet gap, or a new touch after a commit.
 *
 * In the app the host knows the fingers' phases: it holds back the rest of a committed gesture and counts each
 * new touch (`touch`, the current count), so a committed gesture ends exactly when the fingers come down again:
 * fast swipes in a row each count, one swipe never counts twice. A browser has no phases: there a fresh push the
 * same way once the momentum faded counts.
 */
export function isFresh(g: Gesture | undefined, s: Sample, touch?: number): boolean {
  if (!g || s.t - g.last > QUIET_MS) return true
  if (touch !== undefined && g.owner === 'committed') return touch > (g.touch ?? touch)
  const size = Math.hypot(s.x, s.y)
  const sameWay = g.owner !== 'committed' || directionOf(s) === g.swipe
  return g.owner !== 'tracking' && sameWay && g.floor < g.peak / 4 && size > g.floor * 3 && size > 6
}

/** Marks `g` committed to `swipe` at sample `s`: the rest of the gesture and its momentum belong to it. */
export function commit(g: Gesture, s: Sample, swipe: Swipe, touch?: number) {
  const size = Math.hypot(s.x, s.y)
  Object.assign(g, { owner: 'committed', peak: size, floor: size, swipe, touch })
}

/** The host's side of a gesture, in the app: ending a committed one, and the count of touches since. */
export interface NativeGestures {
  end(): void
  touches(): number
}

/** `g` continued by `s` (`g` undefined: a new gesture). */
export function track(g: Gesture | undefined, s: Sample): Gesture {
  const size = Math.hypot(s.x, s.y)
  const base: Gesture = g ?? { last: s.t, x: 0, y: 0, owner: 'tracking', peak: size, floor: size }
  const x = base.x + s.x
  const y = base.y + s.y
  const axis = base.axis ?? (Math.abs(x) + Math.abs(y) >= LOCK_PX ? (Math.abs(x) > Math.abs(y) ? 'x' : 'y') : undefined)
  return { ...base, last: s.t, x, y, axis, peak: Math.max(base.peak, size), floor: Math.min(base.floor, size) }
}

/** The swipe a tracking gesture has travelled far enough to commit, if any. */
export function swipeOf(g: Gesture): Swipe | undefined {
  if (g.owner !== 'tracking' || !g.axis) return
  const d = g.axis === 'x' ? g.x : g.y
  if (Math.abs(d) < COMMIT_PX) return
  if (g.axis === 'x') return d > 0 ? 'right' : 'left'
  return d > 0 ? 'down' : 'up'
}

declare global {
  interface WheelEvent {
    /** WebKit: the deltas are inverted from the device, i.e. natural scrolling is on. */
    readonly webkitDirectionInvertedFromDevice?: boolean
  }
}

const LINE_PX = 16

function sampleOf(event: WheelEvent): Sample {
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PX : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1
  // Natural scrolling inverts the deltas: the content follows the fingers, so the fingers move against the scroll.
  const finger = (event.webkitDirectionInvertedFromDevice ? -1 : 1) * unit
  return { t: event.timeStamp, x: event.deltaX * finger, y: event.deltaY * finger }
}

/**
 * A scroller between `target` and `root` that can still scroll along `axis` in the wheel's direction `sign`.
 * One marked `data-swipe-through` (the island's content on its first snap) lets vertical swipes pass to the island.
 */
function scrollerFor(target: Element, root: Element, axis: 'x' | 'y', sign: number): boolean {
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (axis === 'y' && el.hasAttribute('data-swipe-through')) continue
    const style = getComputedStyle(el)
    const overflow = axis === 'y' ? style.overflowY : style.overflowX
    if (overflow !== 'auto' && overflow !== 'scroll') continue
    const position = axis === 'y' ? el.scrollTop : el.scrollLeft
    const max = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
    if (sign > 0 ? position < max - 1 : position > 0) return true
  }
  return false
}

/** The overflowing tab strip under `target`, which takes the whole gesture. */
function stripFor(target: Element): HTMLElement | null {
  const strip = target.closest<HTMLElement>('[data-tab-strip]')
  return strip && strip.scrollWidth > strip.clientWidth ? strip : null
}

/**
 * Two-finger swipes (wheel events) over `root`, one swipe per gesture: deltas add up until they pass
 * `COMMIT_PX` along the locked axis, then the rest of the gesture and its momentum are ignored. A scroller
 * under the pointer that can still scroll that way keeps the gesture; the overflowing tab strip takes any
 * wheel and scrolls sideways. `onSwipe` reads current state itself, so the listener is installed once.
 */
export function useSwipes(root: RefObject<HTMLElement | null>, onSwipe: (swipe: Swipe) => void, native?: NativeGestures) {
  const handler = useRef(onSwipe)
  handler.current = onSwipe
  const host = useRef(native)
  host.current = native

  useEffect(() => {
    const el = root.current
    if (!el) return
    let gesture: Gesture | undefined
    let strip: HTMLElement | null = null

    const onWheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element)) return
      const sample = sampleOf(event)
      const fresh = isFresh(gesture, sample, host.current?.touches())
      const g = track(fresh ? undefined : gesture, sample)
      gesture = g
      if (fresh) {
        strip = stripFor(event.target)
        if (strip) g.owner = 'strip'
      }

      if (g.owner === 'strip' && strip) {
        event.preventDefault()
        strip.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        return
      }
      if (g.owner !== 'tracking' || !g.axis) return
      const wheel = g.axis === 'x' ? event.deltaX : event.deltaY
      if (wheel !== 0 && scrollerFor(event.target, el, g.axis, wheel)) {
        g.owner = 'scroller'
        return
      }
      const swipe = swipeOf(g)
      if (!swipe) return
      commit(g, sample, swipe, host.current?.touches())
      host.current?.end()
      handler.current(swipe)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [root])
}
