import type { ScreenGeometry } from '@just-notch/bridge-schema'
import { AppWindow, Clipboard, Folder, Layers, type LucideIcon, Search } from 'lucide-react'
import { AnimatePresence, animate, motion, type MotionValue, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useId, useRef, useState } from 'react'
import { dispatch } from '../activity/store'
import { on } from '../host/bus'
import { call } from '../host/client'
import { setLauncherRegions } from '../island/hit-regions'
import { useReduceMotion } from '../island/motion'

/** The search pill, then the round scope buttons to its right, as macOS 26 Spotlight lays them out. */
const PILL_W = 520
const PILL_H = 52
const BUTTON = 52
const GAP = 10
const ROW_W = PILL_W + 4 * (GAP + BUTTON)
/** The drop as it leaves the notch, and as it lands. */
const DROP = 26
const RESULTS_GAP = 8
const RESULTS_H = 320

// The island's goo: blur, then threshold the alpha back into solid shapes, so nearby bodies melt together.
const GOO_MATRIX = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10'
const GOO_BLUR = 7

interface Scope {
  id: string
  title: string
  icon: LucideIcon
}

/** Placeholders for the spike: phase 1 fills Apps, later phases the rest (plugins add their own). */
const SCOPES: Scope[] = [
  { id: 'apps', title: 'Applications', icon: AppWindow },
  { id: 'files', title: 'Files', icon: Folder },
  { id: 'actions', title: 'Actions', icon: Layers },
  { id: 'clipboard', title: 'Clipboard', icon: Clipboard },
]

type Phase = 'closed' | 'opening' | 'open' | 'closing'

interface Layout {
  cx: number
  /** The notch's bottom edge, where the drop forms. */
  notchBottom: number
  rowLeft: number
  pillCx: number
  /** The pill's vertical centre. */
  pillCy: number
  top: number
  buttonCx: (index: number) => number
}

function layoutOf(geometry: ScreenGeometry, top: number): Layout {
  const cx = geometry.notch.x + geometry.notch.w / 2
  const rowLeft = Math.round(cx - ROW_W / 2)
  return {
    cx,
    notchBottom: geometry.notch.h,
    rowLeft,
    pillCx: rowLeft + PILL_W / 2,
    pillCy: top + PILL_H / 2,
    top,
    buttonCx: (index) => rowLeft + PILL_W + GAP + BUTTON / 2 + index * (GAP + BUTTON),
  }
}

/** A body on motion values: centre and size; its corners are always fully round. */
function useBody() {
  return { x: useMotionValue(0), y: useMotionValue(0), w: useMotionValue(0), h: useMotionValue(0) }
}
type Body = ReturnType<typeof useBody>

function BodyRect({ body }: { body: Body }) {
  const x = useTransform(() => body.x.get() - body.w.get() / 2)
  const y = useTransform(() => body.y.get() - body.h.get() / 2)
  const r = useTransform(() => Math.min(body.w.get(), body.h.get()) / 2)
  return <motion.rect x={x} y={y} width={body.w} height={body.h} rx={r} />
}

function ButtonCircle({ x, r, cy }: { x: MotionValue<number>; r: MotionValue<number>; cy: number }) {
  return <motion.circle cx={x} cy={cy} r={r} />
}

const set = (body: Body, v: { x?: number; y?: number; w?: number; h?: number }) => {
  if (v.x !== undefined) body.x.set(v.x)
  if (v.y !== undefined) body.y.set(v.y)
  if (v.w !== undefined) body.w.set(v.w)
  if (v.h !== undefined) body.h.set(v.h)
}

/**
 * The launcher: a drop of the island's black falls from the notch to where Spotlight's search sits and spreads
 * into the search pill; the scope buttons bud off its end. Closing runs it back up into the notch.
 *
 * Spike scope: the motion, the keyboard and the host round trip. Search itself comes in phase 1.
 */
export default function Launcher({ geometry }: { geometry: ScreenGeometry }) {
  const reduced = useReduceMotion()
  const gooId = useId()
  const [phase, setPhase] = useState<Phase>('closed')
  const [top, setTop] = useState(220)
  const [goo, setGoo] = useState(false)
  const [content, setContent] = useState(false)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<number>()
  const input = useRef<HTMLInputElement>(null)
  const run = useRef(0)
  const phaseRef = useRef<Phase>('closed')
  phaseRef.current = phase

  const neck = useBody()
  const drop = useBody()
  const buttons = [0, 1, 2, 3].map(() => ({ x: useMotionValue(0), r: useMotionValue(0) }))

  const layout = layoutOf(geometry, top)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const regions = (l: Layout, results: boolean) =>
    setLauncherRegions([
      { x: l.rowLeft - 8, y: l.top - 8, w: ROW_W + 16, h: PILL_H + 16 + (results ? RESULTS_GAP + RESULTS_H : 0) },
    ])

  async function openSequence(l: Layout) {
    const token = ++run.current
    const alive = () => token === run.current
    setPhase('opening')
    setContent(false)
    setQuery('')
    setScope(undefined)
    dispatch({ type: 'collapse' })
    regions(l, false)
    for (const b of buttons) {
      b.x.set(l.pillCx + PILL_W / 2 - BUTTON / 2)
      b.r.set(0)
    }

    if (reduced) {
      set(neck, { x: l.cx, y: 0, w: 0, h: 0 })
      set(drop, { x: l.pillCx, y: l.pillCy, w: PILL_W, h: PILL_H })
      buttons.forEach((b, i) => {
        b.x.set(l.buttonCx(i))
        b.r.set(BUTTON / 2)
      })
      setContent(true)
      setPhase('open')
      return
    }

    setGoo(true)
    // The neck hangs from inside the notch, so its blurred top melts into the island's black.
    set(neck, { x: l.cx, y: l.notchBottom / 2, w: DROP * 1.1, h: l.notchBottom })
    set(drop, { x: l.cx, y: l.notchBottom, w: 0, h: 0 })

    // 1. Swell: the notch's bottom edge sags and a drop forms under it.
    await Promise.all([
      animate(neck.h, l.notchBottom + 16, { type: 'spring', visualDuration: 0.12, bounce: 0 }),
      animate(neck.y, (l.notchBottom + 16) / 2, { type: 'spring', visualDuration: 0.12, bounce: 0 }),
      animate(drop.w, DROP, { type: 'spring', visualDuration: 0.12, bounce: 0 }),
      animate(drop.h, DROP, { type: 'spring', visualDuration: 0.12, bounce: 0 }),
      animate(drop.y, l.notchBottom + 10, { type: 'spring', visualDuration: 0.12, bounce: 0 }),
    ])
    if (!alive()) return

    // 2. Fall: gravity's ease-in, the drop stretching as it speeds up; the neck follows, thins and snaps back.
    const fall = 0.3
    await Promise.all([
      animate(drop.y, [l.notchBottom + 10, l.pillCy], { duration: fall, ease: [0.55, 0, 0.85, 0.45] }),
      animate(drop.h, [DROP, DROP * 1.55, DROP * 1.2], { duration: fall, times: [0, 0.55, 1] }),
      animate(drop.w, [DROP, DROP * 0.82, DROP * 1.05], { duration: fall, times: [0, 0.55, 1] }),
      animate(drop.x, [l.cx, l.pillCx], { duration: fall, ease: 'easeInOut' }),
      animate(neck.h, [l.notchBottom + 16, l.notchBottom + 44, l.notchBottom * 0.6], { duration: fall * 0.75, times: [0, 0.35, 1] }),
      animate(neck.y, [(l.notchBottom + 16) / 2, (l.notchBottom + 44) / 2, (l.notchBottom * 0.6) / 2], {
        duration: fall * 0.75,
        times: [0, 0.35, 1],
      }),
      animate(neck.w, [DROP * 1.1, DROP * 0.45, DROP * 0.9], { duration: fall * 0.75, times: [0, 0.35, 1] }),
    ])
    if (!alive()) return

    // 3. Spread: it lands and flattens into the pill with a surface-tension wobble; the buttons bud off its end.
    const splash = { type: 'spring' as const, visualDuration: 0.38, bounce: 0.28 }
    setTimeout(() => alive() && setContent(true), 160)
    await Promise.all([
      animate(drop.w, PILL_W, splash),
      animate(drop.h, PILL_H, { ...splash, bounce: 0.4 }),
      ...buttons.flatMap((b, i) => [
        animate(b.x, l.buttonCx(i), { type: 'spring', visualDuration: 0.34, bounce: 0.3, delay: 0.1 + i * 0.04 }),
        animate(b.r, BUTTON / 2, { type: 'spring', visualDuration: 0.3, bounce: 0.35, delay: 0.1 + i * 0.04 }),
      ]),
    ])
    if (!alive()) return
    setGoo(false)
    setPhase('open')
  }

  async function closeSequence() {
    if (phaseRef.current === 'closed' || phaseRef.current === 'closing') return
    const token = ++run.current
    const alive = () => token === run.current
    const l = layoutRef.current
    setPhase('closing')
    setContent(false)
    input.current?.blur()
    const finish = () => {
      if (!alive()) return
      setGoo(false)
      setPhase('closed')
      setLauncherRegions([])
      void call('runtime', 'launcher.closed', {}).catch(() => {})
    }

    if (reduced) return finish()

    setGoo(true)
    set(neck, { x: l.cx, y: l.notchBottom * 0.3, w: DROP * 0.9, h: l.notchBottom * 0.6 })
    // 1. The buttons fold back into the pill, the pill draws in to a drop.
    const end = l.pillCx + PILL_W / 2 - BUTTON / 2
    await Promise.all([
      ...buttons.flatMap((b, i) => [
        animate(b.x, end, { type: 'spring', visualDuration: 0.14, bounce: 0, delay: (3 - i) * 0.02 }),
        animate(b.r, 0, { type: 'spring', visualDuration: 0.14, bounce: 0, delay: (3 - i) * 0.02 }),
      ]),
      animate(drop.w, DROP, { type: 'spring', visualDuration: 0.2, bounce: 0, delay: 0.04 }),
      animate(drop.h, DROP, { type: 'spring', visualDuration: 0.2, bounce: 0, delay: 0.04 }),
    ])
    if (!alive()) return

    // 2. It rises into the notch, which reaches down for it, and is taken in.
    const rise = 0.24
    await Promise.all([
      animate(drop.y, l.notchBottom + 6, { duration: rise, ease: [0.35, 0, 0.2, 1] }),
      animate(drop.x, l.cx, { duration: rise, ease: 'easeInOut' }),
      animate(drop.h, [DROP, DROP * 1.35, DROP], { duration: rise, times: [0, 0.5, 1] }),
      animate(neck.h, [l.notchBottom * 0.6, l.notchBottom * 0.6, l.notchBottom + 18], { duration: rise, times: [0, 0.6, 1] }),
      animate(neck.y, [l.notchBottom * 0.3, l.notchBottom * 0.3, (l.notchBottom + 18) / 2], { duration: rise, times: [0, 0.6, 1] }),
    ])
    if (!alive()) return
    await Promise.all([
      animate(drop.w, 0, { type: 'spring', visualDuration: 0.12, bounce: 0 }),
      animate(drop.h, 0, { type: 'spring', visualDuration: 0.12, bounce: 0 }),
      animate(drop.y, l.notchBottom / 2, { type: 'spring', visualDuration: 0.12, bounce: 0 }),
      animate(neck.h, l.notchBottom * 0.5, { type: 'spring', visualDuration: 0.16, bounce: 0.3 }),
      animate(neck.y, l.notchBottom * 0.25, { type: 'spring', visualDuration: 0.16, bounce: 0.3 }),
    ])
    finish()
  }

  useEffect(
    () =>
      on('launcher', ({ open, top: next }) => {
        if (open) {
          setTop(next)
          void openSequence(layoutOf(geometry, next))
        } else void closeSequence()
      }),
    [geometry],
  )

  // Typing works from the moment the drop forms: the field takes focus as soon as it exists.
  useEffect(() => {
    if (phase === 'opening' || phase === 'open') input.current?.focus()
  }, [phase, content])

  useEffect(() => {
    if (phase === 'open') regions(layout, query !== '')
  }, [phase, query !== '', top])

  useEffect(() => {
    if (phase !== 'opening' && phase !== 'open') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (query) setQuery('')
        else if (scope !== undefined) setScope(undefined)
        else void closeSequence()
        return
      }
      if (event.metaKey && /^[1-4]$/.test(event.key)) {
        event.preventDefault()
        setScope(Number(event.key) - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, query, scope])

  if (phase === 'closed') return null

  const active = scope === undefined ? undefined : SCOPES[scope]
  const showResults = phase === 'open' && query !== ''

  return (
    <div className="pointer-events-none absolute top-0 left-0" style={{ width: geometry.panel.w, height: geometry.panel.h }}>
      <svg aria-hidden className="absolute inset-0 overflow-visible" width={geometry.panel.w} height={geometry.panel.h}>
        <defs>
          <filter id={gooId} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={GOO_BLUR} result="blur" />
            <feColorMatrix in="blur" mode="matrix" values={GOO_MATRIX} result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
        <g className="fill-island" style={goo ? { filter: `url(#${CSS.escape(gooId)})` } : undefined}>
          {goo && <BodyRect body={neck} />}
          <BodyRect body={drop} />
          {buttons.map((b, i) => (
            <ButtonCircle key={i} x={b.x} r={b.r} cy={layout.pillCy} />
          ))}
        </g>
      </svg>

      <motion.div
        className="pointer-events-auto absolute flex items-center text-foreground"
        style={{ left: layout.rowLeft, top: layout.top, width: ROW_W, height: PILL_H, gap: GAP }}
        // Mounted from the first frame, so the field has focus and takes keys while the drop still falls.
        initial={{ opacity: 0 }}
        animate={{ opacity: content ? 1 : 0 }}
        transition={{ duration: content ? 0.18 : 0.08, ease: 'easeOut' }}
      >
        <label
          className="flex h-full items-center gap-3 rounded-full px-4 ring-1 ring-white/10 ring-inset"
          style={{ width: PILL_W }}
        >
          <Search className="size-5 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            aria-label="Search"
            value={query}
            placeholder={active ? active.title : 'Spotlight Search'}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[20px] text-foreground outline-none placeholder:text-muted-foreground"
            onChange={(event) => setQuery(event.target.value)}
          />
          {active && (
            <span className="flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
              <kbd className="rounded-md bg-surface-3 px-1.5 py-0.5">⌘</kbd>
              <kbd className="rounded-md bg-surface-3 px-1.5 py-0.5">{(scope ?? 0) + 1}</kbd>
            </span>
          )}
        </label>
        {SCOPES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            title={`${s.title} ⌘${i + 1}`}
            aria-pressed={scope === i}
            className="flex shrink-0 items-center justify-center rounded-full text-muted-foreground ring-1 ring-white/10 ring-inset hover:text-foreground aria-pressed:bg-surface-3 aria-pressed:text-foreground"
            style={{ width: BUTTON, height: BUTTON }}
            onClick={() => {
              setScope(scope === i ? undefined : i)
              input.current?.focus()
            }}
          >
            <s.icon className="size-5" />
          </button>
        ))}
      </motion.div>

      <AnimatePresence>
        {showResults && (
          <motion.div
            key="results"
            className="pointer-events-auto absolute overflow-hidden rounded-[26px] bg-[var(--island)] p-3 text-foreground ring-1 ring-white/10 ring-inset"
            style={{ left: layout.rowLeft, top: layout.top + PILL_H + RESULTS_GAP, width: PILL_W, height: RESULTS_H, transformOrigin: 'top' }}
            initial={{ opacity: 0, scaleY: 0.6, y: -12 }}
            animate={{ opacity: 1, scaleY: 1, y: 0 }}
            exit={{ opacity: 0, scaleY: 0.8, y: -8, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.2 }}
          >
            <p className="px-2 py-1.5 text-caption text-muted-foreground">{active ? active.title : 'Top hits'}</p>
            <div className="rounded-xl bg-surface-3 px-3 py-2.5">{query}</div>
            <p className="px-2 pt-3 text-caption text-muted-foreground">Search arrives in phase 1.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
