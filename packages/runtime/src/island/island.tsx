import type { Rect, ScreenGeometry } from '@just-notch/bridge-schema'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { present } from '../activity/reducer'
import { dispatch, getState, useActivityState } from '../activity/store'
import { on } from '../host/bus'
import { call } from '../host/client'
import PluginView from '../plugins/plugin-view'
import Expanded from './expanded'
import { type Box, boxOf, bubbleFor, centerX, islandPath, rectOf, type Shape, shapeFor, slotWidth, union } from './geometry'
import {
  bubbleTransition,
  contentEnter,
  contentHidden,
  contentLeave,
  contentShown,
  shapeTransition,
  useReduceMotion,
} from './motion'

const HOVER_INTENT_MS = 120
const HOVER_LEAVE_MS = 400
// The goo filter (modo-ui's, from its morph layer): blur, then threshold the alpha back into solid shapes.
const GOO_MATRIX = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10'
const GOO_BLUR = 6

function setHitRegions(rects: Rect[]) {
  void call('runtime', 'window.setHitRegions', { rects }).catch(() => {})
}

/** Expands after a short hover intent or on click; collapses a moment after the pointer leaves, or on Escape. */
function useHoverIntent(expanded: boolean) {
  const inside = useRef({ host: false, dom: false })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const update = () => {
    clearTimeout(timer.current)
    const hovering = inside.current.host || inside.current.dom
    const open = getState().expanded
    if (hovering && !open) timer.current = setTimeout(() => dispatch({ type: 'expand' }), HOVER_INTENT_MS)
    if (!hovering && open) timer.current = setTimeout(() => dispatch({ type: 'collapse' }), HOVER_LEAVE_MS)
  }

  useEffect(
    () =>
      on('hover', ({ inside: host }) => {
        inside.current.host = host
        update()
      }),
    [],
  )

  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && dispatch({ type: 'collapse' })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  useEffect(() => () => clearTimeout(timer.current), [])

  const dom = (value: boolean) => () => {
    inside.current.dom = value
    update()
  }
  return { onPointerEnter: dom(true), onPointerLeave: dom(false) }
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

/** One presentation's content, swapped with Apple's blur and scale. */
function Layer({ box, origin, reduced, children }: LayerProps) {
  const hidden = reduced ? { opacity: 0 } : contentHidden
  return (
    <motion.div
      className="pointer-events-auto absolute"
      style={{ ...box, transformOrigin: origin }}
      initial={hidden}
      animate={reduced ? { opacity: 1 } : contentShown}
      exit={{ ...hidden, transition: contentLeave }}
      transition={contentEnter}
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
  const presentation = present(useActivityState())
  const { island, primary, secondary, flash } = presentation
  const reduced = useReduceMotion()
  const gooId = useId()
  const hover = useHoverIntent(island === 'expanded')

  const shape = shapeFor(island, geometry)
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
    const transition = reduced ? { duration: 0 } : shapeTransition(from, island)
    const bubbleRect = (): Rect => ({ x: cx + bubble.x - bubble.r, y: notch.h / 2 - bubble.r, w: bubble.r * 2, h: bubble.r * 2 })
    const target = rectOf(shape, geometry)

    // While it moves, clicks land anywhere it is or is going; at rest, only where it is.
    setHitRegions([union(rectOf(current(), geometry), target), ...(split ? [bubbleRect()] : [])])
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
      setBubbleShown(split)
      setHitRegions([target, ...(split ? [bubbleRect()] : [])])
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
        <Expanded primary={primary} shape={shape} geometry={geometry} />
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
    // Hover and click arrive from the shape and the content inside it; everything else passes through.
    <div
      id="island"
      data-state={island}
      className="dark island pointer-events-none absolute top-0 left-0"
      style={{ width: panel.w, height: panel.h }}
      onPointerEnter={hover.onPointerEnter}
      onPointerLeave={hover.onPointerLeave}
      onClick={() => island === 'expanded' || dispatch({ type: 'expand' })}
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

      <motion.div className="pointer-events-none absolute inset-0 text-foreground" style={{ clipPath }}>
        <AnimatePresence initial={false}>{content}</AnimatePresence>
      </motion.div>

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
              exit={{ opacity: 0, transition: contentLeave }}
              transition={contentEnter}
            >
              <PluginView plugin={secondary.plugin} view={secondary.spec.minimal} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
