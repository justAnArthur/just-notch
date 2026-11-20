import type { Rect, ScreenGeometry } from '@just-notch/bridge-schema'
import type { IslandState } from '@just-notch/sdk'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { present, SETTINGS_TAB, type Snap } from '../activity/reducer'
import { dispatch, getState, holdFlash, useActivityState } from '../activity/store'
import { on } from '../host/bus'
import { call } from '../host/client'
import { isLauncherOpen } from '../launcher/state'
import { type LoadedPlugin, usePlugins } from '../plugins/loader'
import PluginView from '../plugins/plugin-view'
import Expanded, { type TabStep } from './expanded'
import { POPUP_SELECTOR, setIslandRegions, trackPopups } from './hit-regions'
import { type Box, boxOf, bubbleFor, centerX, islandPath, presentedState, rectOf, type Shape, shapeFor, slotWidth, union } from './geometry'
import { type NativeGestures, type Swipe, useSwipes } from './gestures'
import { openingTab, tabsOf } from './tab-order'
import {
  bubbleTransition,
  contentEnter,
  contentFade,
  contentGone,
  contentHidden,
  contentLeave,
  contentShown,
  hoverDelay,
  motionScale,
  settle,
  shapeTransition,
  useReduceMotion,
} from './motion'

// The goo filter (modo-ui's, from its morph layer): blur, then threshold the alpha back into solid shapes.
const GOO_MATRIX = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10'
const GOO_BLUR = 6

const INTERACTIVE = 'button, a, input, select, textarea, label, [role=slider], [role=switch], [role=tab], [role=menuitem], [contenteditable]'

/** The running plugins, as the island last rendered them, for opening on the right tab outside a render. */
const loaded: { current: LoadedPlugin[] } = { current: [] }

/** The display shows no island (`hidden`): hover, clicks and swipes open nothing; only Settings still opens it. */
const display = { hidden: false }

/** Clicks land only where something is drawn: a shape drawn into the top edge takes none. */
const solid = (rects: Rect[]) => rects.filter((r) => r.w > 0 && r.h > 0)

/** Opens the island on the activity's tab, else the last one shown if it has content, else the first with content. */
function expand() {
  if (display.hidden) return
  const state = getState()
  const { primary } = present(state)
  const tab = openingTab(tabsOf(primary, loaded.current), state.tab, primary)
  dispatch(tab ? { type: 'expand', tab } : { type: 'expand' })
}

/** The pointer is over the island (its shape or content) or over one of its popups. */
const overIsland = (target: EventTarget | null) => target instanceof Element && target.closest(`#island, ${POPUP_SELECTOR}`) !== null

/**
 * Hover from the host's native tracking and from the page. Expands after a short hover intent and collapses a
 * moment after the pointer leaves; over a flash it only holds the flash open (a click expands it).
 */
function useHover(island: IslandState) {
  const [hovering, setHovering] = useState(false)
  const inside = useRef({ host: false, dom: false })
  const sync = () => setHovering(inside.current.host || inside.current.dom)

  useEffect(
    () =>
      on('hover', ({ inside: host }) => {
        inside.current.host = host
        // Outside the host's zone and hit regions nothing on the page is under the pointer, whatever the page last saw.
        if (!host) inside.current.dom = false
        sync()
      }),
    [],
  )

  // Hit-tested on every move, not pointerleave: that never fires when the hovered node is removed (a tab
  // swapped by a newly enabled plugin), which left the island stuck open.
  useEffect(() => {
    const set = (dom: boolean) => {
      if (dom === inside.current.dom) return
      inside.current.dom = dom
      sync()
    }
    const move = (event: PointerEvent) => set(overIsland(event.target))
    const out = (event: PointerEvent) => event.relatedTarget === null && set(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerover', move)
    document.addEventListener('pointerout', out)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerover', move)
      document.removeEventListener('pointerout', out)
    }
  }, [])

  const flash = island === 'flash'
  const expanded = island === 'expanded'
  useEffect(() => holdFlash(hovering && flash), [hovering, flash])

  // Only entering and leaving act, so Escape (or a flash ending) under a resting pointer doesn't reopen it.
  useEffect(() => {
    const act = () => {
      if (hovering && isLauncherOpen()) return
      if (hovering === getState().expanded || (hovering && present(getState()).island === 'flash')) return
      if (hovering) expand()
      else dispatch({ type: 'collapse' })
    }
    const timer = setTimeout(act, hovering ? hoverDelay.intent : hoverDelay.leave)
    return () => clearTimeout(timer)
  }, [hovering])

  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && dispatch({ type: 'collapse' })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])
}

/**
 * A click expands the island unless its press went to a control (a slider in a flash, a button). Controls that
 * handle the press themselves stop or prevent it, so only a press that reaches the root untouched counts.
 */
function useClickToExpand(island: IslandState) {
  const onSurface = useRef(false)
  return {
    onPointerDownCapture: () => {
      onSurface.current = false
    },
    onPointerDown: (event: React.PointerEvent) => {
      onSurface.current = !event.defaultPrevented && event.target instanceof Element && event.target.closest(INTERACTIVE) === null
    },
    onClick: () => {
      const surface = onSurface.current
      onSurface.current = false
      if (surface && island !== 'expanded') expand()
    },
  }
}

const haptic = (pattern: 'generic' | 'alignment') => void call('runtime', 'window.haptic', { pattern }).catch(() => {})

/**
 * Swipe down opens the island and then pulls it to the tall snap, swipe up steps back the same way; sideways,
 * the open island changes tab and a split one swaps its activities. Each committed swipe taps the trackpad.
 */
let touches = 0
on('gesture.touch', () => {
  touches++
})
const nativeGestures: NativeGestures = {
  end: () => void call('runtime', 'window.endGesture', {}).catch(() => {}),
  touches: () => touches,
}

function useIslandSwipes(root: React.RefObject<HTMLDivElement | null>, step: React.RefObject<TabStep | null>) {
  // In the app the host ends a committed gesture natively; the mock host has no trackpad phases.
  const native = document.documentElement.dataset.notch !== 'mock'
  useSwipes(root, (swipe: Swipe) => {
    const state = getState()
    const { island } = present(state)
    const open = island === 'expanded'
    if (swipe === 'down') {
      if (open && state.snap === 1) return
      if (open) dispatch({ type: 'snap', snap: 1 })
      else expand()
      return haptic('generic')
    }
    if (swipe === 'up') {
      if (!open) return
      // Settings lives on the tall snap: up from it closes the island.
      dispatch(state.snap === 1 && state.tab !== SETTINGS_TAB ? { type: 'snap', snap: 0 } : { type: 'collapse' })
      return haptic('generic')
    }
    if (island === 'expanded' && step.current?.(swipe === 'left' ? 1 : -1)) return haptic('alignment')
    if (island !== 'split') return
    dispatch({ type: 'swap' })
    haptic('alignment')
  }, native ? nativeGestures : undefined)
}

function GooFilter({ id }: { id: string }) {
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation={GOO_BLUR} result="blur" />
      <feColorMatrix in="blur" mode="matrix" values={GOO_MATRIX} result="goo" />
      <feComposite in="SourceGraphic" in2="goo" operator="atop" />
    </filter>
  )
}

interface LayerProps {
  box: Box
  origin: string
  reduced: boolean
  children: ReactNode
}

/** One presentation's content: it sharpens and grows in with the shape, and blurs out in place (a crossfade under reduced motion). */
function Layer({ box, origin, reduced, children }: LayerProps) {
  return (
    <motion.div
      className="pointer-events-auto absolute"
      style={{ ...box, transformOrigin: origin }}
      initial={reduced ? { opacity: 0 } : contentHidden}
      animate={reduced ? { opacity: 1 } : contentShown}
      exit={reduced ? { opacity: 0, transition: contentFade } : { ...contentGone, transition: contentLeave }}
      transition={reduced ? contentFade : contentEnter}
    >
      {children}
    </motion.div>
  )
}

function Slot({ plugin, view, box }: { plugin: string; view?: React.ComponentType; box: Box }) {
  return (
    <div className="absolute flex items-center justify-center overflow-hidden" style={box}>
      <PluginView plugin={plugin} view={view} />
    </div>
  )
}

/**
 * The island: one black outline hanging from the top edge, its geometry on
 * motion values (a path for the shape, a clip for the content), so a change
 * of state animates without layout.
 */
export default function Island({ geometry }: { geometry: ScreenGeometry }) {
  const activity = useActivityState()
  const presentation = present(activity)
  // `pill` draws nothing at idle (the shape sits in the top edge); `hidden` draws nothing but Settings.
  const settingsOpen = presentation.island === 'expanded' && activity.tab === SETTINGS_TAB
  const island = settingsOpen ? presentation.island : presentedState(presentation.island, geometry)
  const { primary, secondary, flash } = presentation
  display.hidden = geometry.mode === 'hidden'
  const reduced = useReduceMotion()
  const gooId = useId()
  const root = useRef<HTMLDivElement>(null)
  const step = useRef<TabStep | null>(null)
  loaded.current = usePlugins()
  useHover(island)
  useIslandSwipes(root, step)
  const click = useClickToExpand(island)
  useEffect(() => (root.current ? trackPopups(root.current) : undefined), [])
  useEffect(() => on('settings.open', () => dispatch({ type: 'expand', tab: SETTINGS_TAB })), [])
  // Turning hidden closes an open island (Settings aside), so it doesn't come back open when the display shows it again.
  useEffect(() => {
    const state = getState()
    if (geometry.mode === 'hidden' && state.expanded && state.tab !== SETTINGS_TAB) dispatch({ type: 'collapse' })
  }, [geometry.mode])
  const { snap } = activity
  // Measured per snap, so the tall snap never borrows the first snap's height for a frame.
  const [fit, setFit] = useState<{ snap: Snap; height: number }>()

  const shape = shapeFor(island, settingsOpen ? { ...geometry, mode: 'full' } : geometry, { snap, content: fit?.snap === snap ? fit.height : undefined, fill: activity.tab === SETTINGS_TAB })
  const split = island === 'split'
  const bubble = bubbleFor(shape, geometry, split)
  const cx = centerX(geometry)
  const { panel, notch } = geometry

  const w = useMotionValue(shape.w)
  const h = useMotionValue(shape.h)
  const radius = useMotionValue(shape.radius)
  const shoulder = useMotionValue(shape.shoulder)
  const bubbleX = useMotionValue(bubble.x)
  const bubbleR = useMotionValue(bubble.r)
  const [goo, setGoo] = useState(false)
  const [bubbleShown, setBubbleShown] = useState(split)
  // The content clip is a full-panel mask layer: only needed while the outline moves, at rest content sits inside it.
  const [moving, setMoving] = useState(false)

  const current = (): Shape => ({ w: w.get(), h: h.get(), radius: radius.get(), shoulder: shoulder.get() })
  const d = useTransform(() => islandPath(cx, current()))
  const clipPath = useTransform(() => {
    const left = cx - w.get() / 2
    const r = radius.get()
    return `inset(0px ${panel.w - left - w.get()}px ${panel.h - h.get()}px ${left}px round 0px 0px ${r}px ${r}px)`
  })
  const bodyX = useTransform(() => cx - w.get() / 2)
  const bodyHeight = useTransform(() => h.get() * 2)
  const bodyY = useTransform(() => -h.get())
  const bubbleCx = useTransform(() => cx + bubbleX.get())
  const bubbleLeft = useTransform(() => cx + bubbleX.get() - bubbleR.get())

  const previous = useRef(island)
  const token = useRef(0)
  useLayoutEffect(() => {
    const from = previous.current
    previous.current = island
    const run = ++token.current
    // A display mode change moves the shape without changing state: it grows out of the edge or settles into it.
    const modeMove = from === island && shape.h !== h.get()
    const transition = reduced ? { duration: 0 } : modeMove ? (shape.h < h.get() ? settle('small') : motionScale.small) : shapeTransition(from, island)
    const bubbleRect = (): Rect => ({ x: cx + bubble.x - bubble.r, y: notch.h / 2 - bubble.r, w: bubble.r * 2, h: bubble.r * 2 })
    const target = rectOf(shape, geometry)

    // While it moves, clicks land anywhere it is or is going; at rest, only where it is.
    setIslandRegions(solid([union(rectOf(current(), geometry), target), ...(split ? [bubbleRect()] : [])]))
    setMoving(!reduced)
    const splitChanged = (from === 'split') !== split
    if (splitChanged) {
      setGoo(!reduced)
      if (split) setBubbleShown(true)
    }
    const bubbleMove = reduced ? { duration: 0 } : splitChanged ? bubbleTransition(split) : transition
    const controls = [
      animate(w, shape.w, transition),
      animate(h, shape.h, transition),
      animate(radius, shape.radius, transition),
      animate(shoulder, shape.shoulder, transition),
      animate(bubbleX, bubble.x, bubbleMove),
      animate(bubbleR, bubble.r, bubbleMove),
    ]
    void Promise.all(controls.map((c) => c.finished)).then(() => {
      if (run !== token.current) return
      setGoo(false)
      setMoving(false)
      setBubbleShown(split)
      setIslandRegions(solid([target, ...(split ? [bubbleRect()] : [])]))
    })
  }, [island, shape.w, shape.h, shape.radius, shape.shoulder, bubble.x, bubble.r, cx])

  useEffect(() => {
    void call('runtime', 'window.setFocusable', { focusable: island === 'expanded' }).catch(() => {})
  }, [island])

  const box = boxOf(shape, geometry)
  const origin = `${cx}px 0px`
  const slot = slotWidth(geometry)
  const compactKey = primary && (island === 'compact' || island === 'split') ? `compact:${primary.plugin}` : null

  let content: ReactNode = null
  if (island === 'expanded') {
    content = (
      <Layer key="expanded" box={box} origin={origin} reduced={reduced}>
        <Expanded primary={primary} shape={shape} geometry={geometry} step={step} onFit={setFit} />
      </Layer>
    )
  } else if (island === 'flash' && flash) {
    content = (
      <Layer key={`flash:${flash.plugin}:${flash.spec.key ?? flash.id}`} box={box} origin={origin} reduced={reduced}>
        <div className="absolute inset-x-0 bottom-0 flex items-center px-5 pb-1" style={{ top: notch.h }}>
          <div className="min-w-0 flex-1">
            <PluginView plugin={flash.plugin} view={flash.spec.view} />
          </div>
        </div>
      </Layer>
    )
  } else if (compactKey && primary) {
    content = (
      <Layer key={compactKey} box={box} origin={origin} reduced={reduced}>
        <Slot plugin={primary.plugin} view={primary.spec.compact.leading} box={{ left: 0, top: 0, width: slot, height: shape.h }} />
        <Slot
          plugin={primary.plugin}
          view={primary.spec.compact.trailing}
          box={{ left: shape.w - slot, top: 0, width: slot, height: shape.h }}
        />
      </Layer>
    )
  }

  return (
    // Clicks arrive from the shape and the content inside it; everything else passes through.
    <div
      ref={root}
      id="island"
      data-state={island}
      data-mode={geometry.mode}
      data-primary={primary?.plugin}
      className="pointer-events-none absolute top-0 left-0"
      style={{ width: panel.w, height: panel.h }}
      {...click}
    >
      <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={panel.w} height={panel.h}>
        <defs>
          <GooFilter id={gooId} />
        </defs>
        {goo && (
          // The filter is the effect itself: it melts the body and the bubble into one shape with a liquid neck.
          <g className="fill-island" style={{ filter: `url(#${CSS.escape(gooId)})` }}>
            <motion.rect x={bodyX} y={bodyY} width={w} height={bodyHeight} rx={radius} />
            <motion.circle cx={bubbleCx} cy={notch.h / 2} r={bubbleR} />
          </g>
        )}
        <g className="pointer-events-auto fill-island">
          <motion.path d={d} />
          {bubbleShown && <motion.circle cx={bubbleCx} cy={notch.h / 2} r={bubbleR} />}
        </g>
      </svg>

      <motion.div className="pointer-events-none absolute inset-0 text-foreground" style={moving ? { clipPath } : undefined}>
        <AnimatePresence initial={false}>{content}</AnimatePresence>
      </motion.div>

      {(split || bubbleShown) && (
        <motion.div
          className="pointer-events-auto absolute top-0 left-0 flex items-center justify-center text-foreground"
          style={{ x: bubbleLeft, y: notch.h / 2 - bubble.r, width: bubble.r * 2, height: bubble.r * 2 }}
        >
          <AnimatePresence initial={false}>
            {split && secondary && (
              <motion.div
                key={secondary.plugin}
                className="flex size-full items-center justify-center"
                initial={reduced ? { opacity: 0 } : contentHidden}
                animate={reduced ? { opacity: 1 } : contentShown}
                exit={{ opacity: 0, transition: reduced ? contentFade : contentLeave }}
                transition={reduced ? contentFade : contentEnter}
              >
                <PluginView plugin={secondary.plugin} view={secondary.spec.minimal} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  )
}
