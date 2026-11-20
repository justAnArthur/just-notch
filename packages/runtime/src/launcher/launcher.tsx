import type { ScreenGeometry } from '@just-notch/bridge-schema'
import { Search } from 'lucide-react'
import { AnimatePresence, animate, motion, type MotionValue, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { present } from '../activity/reducer'
import { dispatch, useActivityState } from '../activity/store'
import { on } from '../host/bus'
import { call } from '../host/client'
import { EXPANDED } from '../island/geometry'
import { setLauncherRegions } from '../island/hit-regions'
import { useReduceMotion } from '../island/motion'
import { bridgePath, type Circle } from './metaball'
import { ActionPanel, filterActions, panelHeight } from './actions'
import { hasPreviews, Preview, PREVIEW_MIN_H } from './preview'
import { MAX_SCOPES, type Scope, scopeByKeyword, useScopes, useSearch } from './providers'
import { Note, Results, SHEET_PAD, SHEET_RADIUS, sectionsHeight } from './results'
import type { Row } from './rows'
import { setLauncherOpen } from './state'

const PILL_H = 52
const BUTTON = 52
const GAP = 10
/** The drop as it falls, and the bud it leaves the notch from. */
const DROP = 34
const BUD = 18
/** The drop while it still hangs from the notch, before it lets go. */
const HANG = 26
const RESULTS_GAP = 8
/** The results sheet grows with its rows up to this, then scrolls. */
const RESULTS_MAX = 420
/** A note's height, for a scope that isn't built yet or nothing found. */
const NOTE_H = 56
/** How far the liquid between the pill's end and a button stretches before it snaps, in button radii: under the gap (10 pt), so none stays joined at rest. */
const BUTTON_REACH = 0.3

type Phase = 'closed' | 'opening' | 'open' | 'closing'

interface Layout {
  cx: number
  /** The notch's bottom edge, where the drop forms. */
  notchBottom: number
  rowW: number
  rowLeft: number
  /** The pill's width beside the scope buttons; alone (while typing) it spans the row. */
  pillW: number
  /** The pill's vertical centre. */
  pillCy: number
  top: number
  buttonCx: (index: number) => number
}

function layoutOf(geometry: ScreenGeometry, top: number, buttons: number): Layout {
  const cx = geometry.notch.x + geometry.notch.w / 2
  const rowW = Math.min(EXPANDED.w, geometry.panel.w - 28)
  const rowLeft = Math.round(cx - rowW / 2)
  const pillW = rowW - buttons * (GAP + BUTTON)
  return {
    cx,
    notchBottom: geometry.notch.h,
    rowW,
    rowLeft,
    pillW,
    pillCy: top + PILL_H / 2,
    top,
    buttonCx: (index) => rowLeft + pillW + GAP + BUTTON / 2 + index * (GAP + BUTTON),
  }
}

/** A body on motion values: centre and size; its corners are always fully round. */
function useBody() {
  return { x: useMotionValue(0), y: useMotionValue(0), w: useMotionValue(0), h: useMotionValue(0) }
}
type Body = ReturnType<typeof useBody>

function BodyRect({ body, outlined = false }: { body: Body; outlined?: boolean }) {
  const x = useTransform(() => body.x.get() - Math.max(0, body.w.get()) / 2)
  const y = useTransform(() => body.y.get() - Math.max(0, body.h.get()) / 2)
  const w = useTransform(() => Math.max(0, body.w.get()))
  const h = useTransform(() => Math.max(0, body.h.get()))
  const r = useTransform(() => Math.max(0, Math.min(body.w.get(), body.h.get())) / 2)
  // The hairline is the rect's own stroke, so it follows the shape without laying out any HTML.
  return (
    <motion.rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={r}
      stroke="white"
      strokeWidth={1}
      style={{ strokeOpacity: outlined ? 0.1 : 0, transition: 'stroke-opacity 120ms' }}
    />
  )
}

function Dot({ x, y, r }: { x: MotionValue<number>; y: MotionValue<number> | number; r: MotionValue<number> }) {
  const radius = useTransform(() => Math.max(0, r.get()))
  return <motion.circle cx={x} cy={y} r={radius} />
}

const set = (body: Body, v: { x?: number; y?: number; w?: number; h?: number }) => {
  if (v.x !== undefined) body.x.set(v.x)
  if (v.y !== undefined) body.y.set(v.y)
  if (v.w !== undefined) body.w.set(v.w)
  if (v.h !== undefined) body.h.set(v.h)
}

/** The drop as a circle, for its bridge: the smaller side's radius around its centre. */
const asCircle = (body: Body): Circle => ({ x: body.x.get(), y: body.y.get(), r: Math.max(0, Math.min(body.w.get(), body.h.get())) / 2 })
/** The pill's right end, the circle its cap is part of. */
const endCap = (body: Body): Circle => {
  const r = Math.max(0, body.h.get()) / 2
  return { x: body.x.get() + Math.max(0, body.w.get()) / 2 - r, y: body.y.get(), r }
}

// Motion tuned to read like water and to be about as quick as Spotlight's own (~0.35 s to the field).
const SWELL = { duration: 0.07, ease: [0.3, 0, 0.6, 1] } as const
/** The bead hangs and stretches on its neck before it lets go. */
const HANG_T = { duration: 0.09, ease: [0.45, 0, 0.55, 1] } as const
/** The fall: off the notch quickly, then easing into the landing, so you see the drop arrive and become the bar. */
const FALL = { duration: 0.2, ease: [0.45, 0, 0.2, 1] } as const
/** Landing: the drop spreads into the bar, fast at first and easing into the ends. */
const FILL = { duration: 0.28, ease: [0.25, 0.75, 0.3, 1] } as const
const SPLIT = { type: 'spring', visualDuration: 0.2, bounce: 0.18 } as const
const RECOIL = { type: 'spring', visualDuration: 0.2, bounce: 0.5 } as const
const QUICK = { type: 'spring', visualDuration: 0.12, bounce: 0 } as const

/**
 * The launcher: a drop of the island's black swells under the notch, pinches off, falls to where Spotlight's
 * search sits, squashes as it lands and spreads into the search bar; the scope buttons then pinch off its end. Typing draws them back into
 * the bar, as Spotlight does. Closing is a quick fade.
 *
 * Every shape is a circle, a rounded rect or the liquid bridge between two of them (metaball.ts), one SVG path
 * per frame: no blur filter, so it stays sharp and smooth.
 *
 * Search covers apps for now: ↑↓ select, ↩ opens, ⌘↩ shows in Finder,
 * ⇥ completes the name, ⌘1–⌘4 pick a scope.
 */
export default function Launcher({ geometry }: { geometry: ScreenGeometry }) {
  const reduced = useReduceMotion()
  const [phase, setPhase] = useState<Phase>('closed')
  const [top, setTop] = useState(220)
  const [content, setContent] = useState(false)
  const [buttonsShown, setButtonsShown] = useState(false)
  /** The pill's hairline, off while it changes shape (it would cut the liquid necks). */
  const [outlined, setOutlined] = useState(false)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<number>()
  const [selected, setSelected] = useState(0)
  /** The selected row's actions (⌘K), with what was typed into it and its own selection. */
  const [panel, setPanel] = useState<{ filter: string; selected: number }>()
  /** The preview pane in the root search, toggled with ⌘Y; scopes with previews always show it. */
  const [quickLook, setQuickLook] = useState(false)
  const scopes = useScopes()
  const scopesRef = useRef(scopes)
  scopesRef.current = scopes
  const input = useRef<HTMLInputElement>(null)
  const run = useRef(0)
  const phaseRef = useRef<Phase>('closed')
  phaseRef.current = phase

  const drop = useBody()
  const bud = { x: useMotionValue(0), y: useMotionValue(0), r: useMotionValue(0) }
  const buttons = Array.from({ length: MAX_SCOPES }, () => ({ x: useMotionValue(0), r: useMotionValue(0) }))
  /** How far the notch ↔ drop neck stretches before it snaps (in the drop's radii): long while it hangs. */
  const reach = useMotionValue(2.5)
  /** The little satellite drop that follows the big one when the neck snaps. */
  const satellite = { y: useMotionValue(0), r: useMotionValue(0) }
  /** The whole launcher's opacity: 1 while open, faded to 0 to close. */
  const fade = useMotionValue(1)
  const fadeScale = useTransform(() => 0.97 + 0.03 * fade.get())

  const layout = layoutOf(geometry, top, scopes.length)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // Every liquid neck in one path: notch ↔ drop, and the pill's end ↔ each button near it.
  const bridges = useTransform(() => {
    const l = layoutRef.current
    const parts = [bridgePath({ x: bud.x.get(), y: bud.y.get(), r: Math.max(0, bud.r.get()) }, asCircle(drop), reach.get(), 0.55)]
    const cap = endCap(drop)
    for (const b of buttons) parts.push(bridgePath(cap, { x: b.x.get(), y: l.pillCy, r: Math.max(0, b.r.get()) }, BUTTON_REACH, 0.45))
    return parts.join('')
  })

  const regions = (l: Layout, results: number) =>
    setLauncherRegions([{ x: l.rowLeft - 8, y: l.top - 8, w: l.rowW + 16, h: PILL_H + 16 + (results ? RESULTS_GAP + results : 0) }])

  /** The pill alone across the row (typing) or beside its buttons, which pinch off its end. */
  function arrange(l: Layout, alone: boolean, instant = false) {
    const w = alone ? l.rowW : l.pillW
    const x = l.rowLeft + w / 2
    if (instant || reduced) {
      setOutlined(true)
      set(drop, { x, w, h: PILL_H })
      buttons.forEach((b, i) => {
        b.x.set(l.buttonCx(i))
        b.r.set(alone || i >= scopesRef.current.length ? 0 : BUTTON / 2)
      })
      setButtonsShown(!alone)
      return Promise.resolve()
    }
    setOutlined(false)
    if (alone) setButtonsShown(false)
    else {
      // They sit under the pill's end already, so as it draws back each one is left behind with a neck that snaps.
      buttons.forEach((b, i) => {
        b.x.set(l.buttonCx(i))
        b.r.set(i < scopesRef.current.length ? BUTTON / 2 : 0)
      })
      setTimeout(() => setButtonsShown(true), 90)
    }
    const moves = [animate(drop.x, x, SPLIT), animate(drop.w, w, SPLIT)]
    // Swallowed: once the pill covers them they're gone.
    if (alone) for (const b of buttons) moves.push(animate(b.r, 0, { ...QUICK, delay: 0.12 }))
    return Promise.all(moves).then(() => setOutlined(true))
  }

  async function openSequence(l: Layout) {
    const token = ++run.current
    const alive = () => token === run.current
    setLauncherOpen(true)
    fade.set(1)
    setPhase('opening')
    setContent(false)
    setButtonsShown(false)
    setOutlined(false)
    setQuery('')
    setScope(undefined)
    setSelected(0)
    setPanel(undefined)
    setQuickLook(false)
    dispatch({ type: 'collapse' })
    regions(l, 0)
    for (const b of buttons) b.r.set(0)

    if (reduced) {
      bud.r.set(0)
      set(drop, { y: l.pillCy, h: PILL_H })
      void arrange(l, false, true)
      setContent(true)
      setPhase('open')
      return
    }

    const budTop = l.notchBottom - BUD
    bud.x.set(l.cx)
    bud.y.set(budTop)
    bud.r.set(0)
    reach.set(4.5)
    satellite.r.set(0)
    set(drop, { x: l.cx, y: budTop, w: 0, h: 0 })

    // 1. Swell: the notch's bottom edge sags into a bead.
    await Promise.all([
      animate(bud.r, BUD, SWELL),
      animate(bud.y, l.notchBottom - 4, SWELL),
      animate(drop.w, HANG, SWELL),
      animate(drop.h, HANG, SWELL),
      animate(drop.y, l.notchBottom + 8, SWELL),
    ])
    if (!alive()) return

    // 2. Hang: it stretches down on a neck that thins.
    await Promise.all([
      animate(drop.y, l.notchBottom + 40, HANG_T),
      animate(drop.h, HANG * 1.2, HANG_T),
      animate(drop.w, HANG * 0.9, HANG_T),
      animate(bud.r, BUD * 0.65, HANG_T),
    ])
    if (!alive()) return

    // 3. Let go: the neck snaps, the notch's bead springs back, a satellite drop trails the big one down.
    reach.set(0.3)
    void animate(bud.y, l.notchBottom - BUD - 2, RECOIL)
    void animate(bud.r, 0, { ...RECOIL, delay: 0.02 })
    satellite.y.set(l.notchBottom + 14)
    satellite.r.set(3.5)
    void animate(satellite.y, l.top - 6, { ...FALL, duration: FALL.duration * 1.05 }).then(() => satellite.r.set(0))
    await Promise.all([
      animate(drop.y, l.pillCy, FALL),
      animate(drop.h, [HANG * 1.2, DROP * 1.2], FALL),
      animate(drop.w, [HANG * 0.9, DROP * 0.9], FALL),
    ])
    if (!alive()) return

    // 4. Land: it squashes as it touches down…
    await Promise.all([
      animate(drop.w, DROP * 1.3, { duration: 0.06, ease: 'easeOut' }),
      animate(drop.h, DROP * 0.8, { duration: 0.06, ease: 'easeOut' }),
    ])
    if (!alive()) return
    // …and spreads into the bar, one rounded shape, rounding out to its height first so its ends stay round.
    setTimeout(() => alive() && setContent(true), 140)
    await Promise.all([
      animate(drop.w, l.rowW, FILL),
      animate(drop.h, PILL_H, { type: 'spring', visualDuration: 0.12, bounce: 0.25 }),
    ])
    if (!alive()) return
    // 5. Then it draws back from its end, leaving the scope buttons behind, each pinching off.
    await arrange(l, false)
    if (!alive()) return
    setPhase('open')
  }

  async function closeSequence() {
    if (phaseRef.current === 'closed' || phaseRef.current === 'closing') return
    const token = ++run.current
    const alive = () => token === run.current
    const l = layoutRef.current
    setPhase('closing')
    setContent(false)
    setOutlined(false)
    input.current?.blur()
    const finish = () => {
      if (!alive()) return
      setPhase('closed')
      setLauncherOpen(false)
      setLauncherRegions([])
      void call('runtime', 'launcher.closed', {}).catch(() => {})
    }
    if (reduced) return finish()

    // Closing has no drop: a quick fade and settle, as Spotlight dismisses, so it gets out of the way at once.
    await Promise.all([animate(fade, 0, { duration: 0.14, ease: [0.4, 0, 1, 1] })])
    if (!alive()) return
    finish()
  }

  useEffect(
    () =>
      on('launcher', ({ open, top: next }) => {
        if (open) {
          setTop(next)
          void openSequence(layoutOf(geometry, next, scopesRef.current.length))
        } else void closeSequence()
      }),
    [geometry],
  )

  // The island opening (hovered, clicked, Settings…) takes over: the launcher steps aside.
  const islandOpen = present(useActivityState()).island === 'expanded'
  useEffect(() => {
    if (islandOpen && (phaseRef.current === 'open' || phaseRef.current === 'opening')) void closeSequence()
  }, [islandOpen])

  // Typing works from the moment the drop forms: the field takes focus as soon as it exists.
  useEffect(() => {
    if (phase === 'opening' || phase === 'open') input.current?.focus()
  }, [phase, content])

  // Typing draws the buttons back into the bar, which spans the row; clearing it lets them out again.
  const typing = query !== ''
  useEffect(() => {
    if (phase === 'open') void arrange(layoutRef.current, typing)
  }, [typing, phase === 'open'])

  const active: Scope | undefined = scope === undefined ? undefined : scopes[scope]
  const view = useSearch(query, active, scopes, phase === 'opening' || phase === 'open')
  const flat = view.sections.flatMap((s) => s.rows)
  const current = flat[selected]
  const listed = panel && current ? filterActions(current.actions, panel.filter) : []
  const panelOpen = panel !== undefined && current !== undefined && view.note === undefined
  const showPane = view.note === undefined && flat.length > 0 && (active ? hasPreviews(flat) : quickLook)
  const rowsH = Math.min(sectionsHeight(view.sections), RESULTS_MAX)
  const listH = view.note ? NOTE_H : showPane ? Math.max(rowsH, PREVIEW_MIN_H) : rowsH
  // The sheet grows to hold the panel when it has fewer rows than the panel has actions.
  const sheetH = panelOpen ? Math.max(listH, panelHeight(listed.length) + 2 * SHEET_PAD) : listH
  const showResults = phase === 'open' && (view.note !== undefined || flat.length > 0)

  // A new query or scope starts at the top.
  useEffect(() => setSelected(0), [query, scope])
  // The panel belongs to one row: another row, query or scope closes it.
  useEffect(() => setPanel(undefined), [query, scope, selected])

  // A scope's keyword and a space enter it: `clip `, `file `.
  useEffect(() => {
    if (scope !== undefined) return
    const hit = scopeByKeyword(query, scopes)
    if (!hit) return
    setScope(scopes.indexOf(hit.scope))
    setQuery(hit.rest)
  }, [query])

  useEffect(() => {
    if (phase === 'open') regions(layout, showResults ? sheetH : 0)
  }, [phase, showResults, sheetH, top])

  /** Closes first, so what the action opens or pastes into comes forward over a clean screen with the keyboard. */
  const runRow = async (row: Row | undefined, action = 0) => {
    const run = row?.actions[action] ?? row?.actions[0]
    if (!row || !run) return
    view.record(row.id)
    await closeSequence()
    // The host lets the keyboard go on `launcher.closed`; give the app in front a moment to take it back.
    await new Promise((resolve) => setTimeout(resolve, 40))
    try {
      await run.run()
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    if (phase !== 'opening' && phase !== 'open') return
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPanel((p) => (p || !current?.actions.length ? undefined : { filter: '', selected: 0 }))
        return
      }
      if (panelOpen) {
        onPanelKey(event)
        return
      }
      if (event.metaKey && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        setQuickLook((on) => !on)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        if (query) setQuery('')
        else if (scope !== undefined) setScope(undefined)
        else void closeSequence()
        return
      }
      if (event.metaKey && /^[1-9]$/.test(event.key)) {
        event.preventDefault()
        const next = Number(event.key) - 1
        if (next < scopes.length) setScope(scope === next ? undefined : next)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!flat.length) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        setSelected((i) => (i + step + flat.length) % flat.length)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        void runRow(flat[selected], event.metaKey ? 1 : event.shiftKey ? 2 : 0)
        return
      }
      if (event.key === 'Backspace' && query === '' && scope !== undefined) {
        event.preventDefault()
        setScope(undefined)
        return
      }
      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault()
        const row = flat[selected]
        if (row && !row.answer && row.id !== 'web') setQuery(row.title)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, query, scope, selected, flat, scopes, panel, panelOpen, listed])

  /** While the panel is open it takes the keys: arrows, Return, Escape, and typing, which filters it. */
  function onPanelKey(event: KeyboardEvent) {
    if (!panel) return
    const key = event.key
    if (key === 'Escape') {
      event.preventDefault()
      setPanel((p) => (p?.filter ? { filter: '', selected: 0 } : undefined))
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      if (!listed.length) return
      const step = key === 'ArrowDown' ? 1 : -1
      setPanel((p) => p && { ...p, selected: (p.selected + step + listed.length) % listed.length })
    } else if (key === 'Enter') {
      event.preventDefault()
      const pick = listed[panel.selected]
      if (pick) void runRow(current, pick.index)
    } else if (key === 'Backspace') {
      event.preventDefault()
      setPanel((p) => p && { filter: p.filter.slice(0, -1), selected: 0 })
    } else if (key.length === 1 && !event.metaKey && !event.ctrlKey) {
      // Kept out of the search field: it filters the panel instead.
      event.preventDefault()
      setPanel((p) => p && { filter: p.filter + key, selected: 0 })
    } else if (key === 'Tab') event.preventDefault()
  }

  if (phase === 'closed') return null

  return (
    <motion.div
      className="pointer-events-none absolute top-0 left-0"
      style={{ width: geometry.panel.w, height: geometry.panel.h, opacity: fade, scale: fadeScale, transformOrigin: `${layout.cx}px ${layout.pillCy}px` }}
    >
      <svg aria-hidden className="absolute inset-0 overflow-visible" width={geometry.panel.w} height={geometry.panel.h}>
        <g className="fill-island">
          <Dot x={bud.x} y={bud.y} r={bud.r} />
          <Dot x={drop.x} y={satellite.y} r={satellite.r} />
          <BodyRect body={drop} outlined={outlined && phase === 'open'} />
          {buttons.map((b, i) => (
            <Dot key={i} x={b.x} y={layout.pillCy} r={b.r} />
          ))}
          <motion.path d={bridges} />
        </g>
      </svg>

      {/* Mounted from the first frame, so the field has focus and takes keys while the drop still falls. */}
      <motion.label
        className="pointer-events-auto absolute flex items-center gap-3 rounded-full px-4 text-foreground"
        style={{ left: layout.rowLeft, top: layout.top, width: typing ? layout.rowW : layout.pillW, height: PILL_H }}
        initial={{ opacity: 0 }}
        animate={{ opacity: content ? 1 : 0 }}
        transition={{ duration: content ? 0.12 : 0.06, ease: 'easeOut' }}
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
      </motion.label>

      {scopes.map((s, i) => (
        <motion.button
          key={s.id}
          type="button"
          title={`${s.title} ⌘${i + 1}`}
          aria-pressed={scope === i}
          tabIndex={-1}
          className="absolute flex items-center justify-center rounded-full text-muted-foreground ring-1 ring-white/10 ring-inset hover:text-foreground aria-pressed:bg-surface-3 aria-pressed:text-foreground"
          style={{
            left: layout.buttonCx(i) - BUTTON / 2,
            top: layout.top,
            width: BUTTON,
            height: BUTTON,
            pointerEvents: content && buttonsShown ? 'auto' : 'none',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: content && buttonsShown ? 1 : 0 }}
          transition={{ duration: 0.1, delay: content && buttonsShown ? i * 0.02 : 0 }}
          onClick={() => {
            setScope(scope === i ? undefined : i)
            input.current?.focus()
          }}
        >
          <s.icon className="size-5" />
        </motion.button>
      ))}

      <AnimatePresence>
        {showResults && (
          <motion.div
            key="results"
            className="pointer-events-auto absolute overflow-hidden bg-[var(--island)] text-foreground ring-1 ring-white/10 ring-inset"
            style={{ left: layout.rowLeft, top: layout.top + PILL_H + RESULTS_GAP, width: layout.rowW, borderRadius: SHEET_RADIUS, transformOrigin: 'top' }}
            initial={{ opacity: 0, scaleY: 0.85, y: -6, height: sheetH }}
            animate={{ opacity: 1, scaleY: 1, y: 0, height: sheetH }}
            exit={{ opacity: 0, scaleY: 0.92, y: -4, transition: { duration: 0.08 } }}
            transition={{ type: 'spring', visualDuration: 0.18, bounce: 0.12 }}
          >
            {view.note ? (
              <Note>{view.note}</Note>
            ) : (
              <div className="flex h-full">
                <div className="min-w-0 flex-1">
                  <Results sections={view.sections} selected={selected} onSelect={panelOpen ? () => {} : setSelected} onRun={(i) => void runRow(flat[i])} compact={showPane} />
                </div>
                {showPane && <Preview row={current} />}
              </div>
            )}
            {panelOpen && (
              <ActionPanel
                row={current}
                listed={listed}
                filter={panel.filter}
                selected={panel.selected}
                onSelect={(i) => setPanel({ ...panel, selected: i })}
                onRun={(i) => void runRow(current, i)}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
