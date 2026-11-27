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
import { motionScale, settle } from '@justanarthur/modo-ui-notch/lib/motion'
import { bridgePath, type Circle } from './metaball'
import { ActionPanel, filterActions, type LauncherCommand, launcherActions, type ListedAction, type PanelMode, panelHeight } from './actions'
import { useItemHotkeys } from './hotkeys'
import { cleanAlias, type ItemPrefs } from './prefs'
import { useLauncherStore } from './store'
import { hasPreviews, Preview, PREVIEW_MIN_H } from './preview'
import { MAX_SCOPES, rowFromSnapshot, type Scope, scopeByKeyword, useScopes, useSearch } from './providers'
import { Kbd, Note, Results, SHEET_PAD, SHEET_RADIUS, sectionsHeight } from './results'
import type { Row } from './rows'
import { moveOf, moveTo, recall } from './navigation'
import { animatesHeight, type Selection, selectedIndex } from './selection'
import { setSettingsTarget } from '../settings/target'
import { onTryLauncher, setLauncherOpen } from './state'
import { showFailure } from './failure'
import { acceleratorOf, actionForKey, numberKey } from './shortcut'
import { useHeld } from './sources'

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
const PLACEHOLDER = 'Search apps, files and commands'
/** The pill's width that fits PLACEHOLDER at 17 px beside the icon and padding; a narrower pill (six scopes) says "Search…". */
const PLACEHOLDER_PILL_W = 332
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

/** The open's beats, in ms: swell, fall, spread until the field shows. Field readable ≈ their sum + FIELD_FADE. */
const SWELL_MS = 40
const FALL_MS = 80
const SPREAD_MS = 50
/** From the field showing to the buttons pinching off, while the bar still settles. */
const SPLIT_AFTER_MS = 120
/** The field's fade in, in seconds. */
const FIELD_FADE = 0.06
const SHEET_SPRING = motionScale.small
/** A provider slower than this shows the loading bar. */
const LOADING_AFTER_MS = 150
const SPLIT = motionScale.small
const QUICK = motionScale.micro
/** The close's fade, in seconds. */
const CLOSE_S = 0.05
/** After the keyboard goes back, before an action runs: the app in front takes it, so a paste lands there. */
const HANDOFF_MS = 40
/** How long a first ↩ on an action that can't be undone waits for the second. */
const CONFIRM_MS = 3000

/**
 * The launcher: a drop of the island's black swells under the notch, pinches off, falls to the upper third of the
 * screen, squashes as it lands and spreads into the search bar; the scope buttons then pinch off its end. Typing draws
 * them back into the bar. Closing is a quick fade.
 *
 * Every shape is a circle, a rounded rect or the liquid bridge between two of them (metaball.ts), one SVG path
 * per frame: no blur filter, so it stays sharp and smooth.
 *
 * ↑↓ select, ↩ runs the row's first action, ⌘↩ and ⇧↩ its next ones, ⌘K lists them all, ⇥ completes the name,
 * ⌘1–⌘6 pick a scope.
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
  const [selection, setSelection] = useState<Selection>()
  /** The selected row's actions (⌘K), with what was typed into it and its own selection. */
  const [panel, setPanel] = useState<{ filter: string; selected: number; mode: PanelMode }>()
  /** Which earlier query ↑ brought back (0 = the newest), until something else is typed. */
  const [recalled, setRecalled] = useState<number>()
  /** The scope button under the pointer, for its tip. */
  const [hovered, setHovered] = useState<number>()
  /** A row whose action asks for a second ↩ (Empty Trash), waiting for it. */
  const [confirming, setConfirming] = useState<string>()
  /** The preview pane in the root search, toggled with ⌘Y; scopes with previews always show it. */
  const [quickLook, setQuickLook] = useState(false)
  const scopes = useScopes()
  /** The scopes with a button; the others are entered by keyword. */
  const buttonScopes = scopes.slice(0, MAX_SCOPES)
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

  const layout = layoutOf(geometry, top, buttonScopes.length)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const fieldWRef = useRef(0)
  /** The field shows only over the bar's black: while the drop spreads, it is revealed with it. */
  const fieldClip = useTransform(() => {
    const l = layoutRef.current
    const left = Math.max(0, drop.x.get() - drop.w.get() / 2 - l.rowLeft)
    const right = Math.max(0, l.rowLeft + fieldWRef.current - (drop.x.get() + drop.w.get() / 2))
    return `inset(0 ${right}px 0 ${left}px round ${PILL_H / 2}px)`
  })

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
    setSelection(undefined)
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

    // On the kit's spring scale, and on a clock: each beat starts the next before its spring settles, so the
    // motion stays one continuous drop and the field is readable within 250 ms.
    const beat = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    // 1. Swell and hang: the notch's edge sags into a bead that stretches down on a thinning neck.
    void animate(bud.r, BUD * 0.8, motionScale.micro)
    void animate(bud.y, l.notchBottom - 4, motionScale.micro)
    void animate(drop.w, HANG * 0.9, motionScale.micro)
    void animate(drop.h, HANG * 1.2, motionScale.micro)
    void animate(drop.y, l.notchBottom + 30, motionScale.micro)
    await beat(SWELL_MS)
    if (!alive()) return

    // 2. Let go: the neck snaps, the bead springs back into the notch, a satellite drop trails the big one down.
    reach.set(0.3)
    void animate(bud.y, l.notchBottom - BUD - 2, motionScale.medium)
    void animate(bud.r, 0, settle('small'))
    satellite.y.set(l.notchBottom + 14)
    satellite.r.set(3.5)
    void animate(satellite.y, l.top - 6, motionScale.small).then(() => satellite.r.set(0))
    void animate(drop.y, l.pillCy, motionScale.small)
    void animate(drop.h, DROP * 0.85, motionScale.small)
    void animate(drop.w, DROP * 1.2, motionScale.small)
    await beat(FALL_MS)
    if (!alive()) return

    // 3. Land: it spreads into the bar (rounding out to its height first, so its ends stay round); the field shows
    // once the bar is most of the way across, and results with it.
    void animate(drop.y, l.pillCy, motionScale.micro)
    void animate(drop.h, PILL_H, motionScale.micro)
    const spread = animate(drop.w, l.rowW, motionScale.small)
    await beat(SPREAD_MS)
    if (!alive()) return
    setContent(true)
    void animate(satellite.r, 0, motionScale.micro)
    await Promise.race([spread, beat(SPLIT_AFTER_MS)])
    if (!alive()) return
    // 4. Open: the scope buttons pinch off the bar's end, unless a key was typed on the way (see the effect below).
    setPhase('open')
  }

  async function closeSequence() {
    if (phaseRef.current === 'closed' || phaseRef.current === 'closing') return
    const token = ++run.current
    const alive = () => token === run.current
    // Closing has no drop: a quick fade and settle, so it gets out of the way at once. It starts before the
    // re-render below, which would otherwise delay its first frame.
    const fading = reduced ? undefined : animate(fade, 0, { duration: CLOSE_S, ease: [0.4, 0, 1, 1] })
    setPhase('closing')
    setContent(false)
    setOutlined(false)
    input.current?.blur()
    // The host lets the keyboard go now, not after the fade: the app in front gets it back at once.
    void call('runtime', 'launcher.closed', {}).catch(() => {})
    const finish = () => {
      if (!alive()) return
      setPhase('closed')
      setLauncherOpen(false)
      setLauncherRegions([])
    }
    if (!fading) return finish()
    await fading
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

  // Settings' Try it: open where the hotkey last opened it.
  useEffect(() => onTryLauncher(() => void openSequence(layoutOf(geometry, layoutRef.current.top, scopesRef.current.length))), [geometry])

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
  const fieldW = typing ? layout.rowW : layout.pillW
  fieldWRef.current = fieldW
  useEffect(() => {
    if (phase === 'open') void arrange(layoutRef.current, typing)
  }, [typing, phase === 'open'])

  const active: Scope | undefined = scope === undefined ? undefined : scopes[scope]
  const store = useLauncherStore()
  const view = useSearch(query, active, scopes, phase === 'opening' || phase === 'open', store)

  /** Runs a kept result's first action with the launcher closed (its hotkey). */
  const runKept = async (row: Row) => {
    performance.mark('launcher.hotkey')
    store.launched(row, '')
    try {
      await row.actions[0]?.run()
    } catch (error) {
      showFailure(row, error)
    }
  }
  useItemHotkeys(store, geometry.screenId, (id) => store.snapshots[id] && rowFromSnapshot(store.snapshots[id], scopes), (row) => void runKept(row))
  const flat = view.sections.flatMap((s) => s.rows)
  const selected = selectedIndex(flat, selection)
  const current = flat[selected]
  const own = current ? launcherActions(current, store.prefs) : []
  const listed = panel && current ? filterActions(current.actions, panel.filter, own) : []
  const panelOpen = panel !== undefined && current !== undefined && view.note === undefined
  // ⌘Y's pane shows only for a row with something to show beyond its own line.
  const showPane = view.note === undefined && flat.length > 0 && (active ? hasPreviews(flat) : quickLook && current?.preview !== undefined)
  const rowsH = Math.min(sectionsHeight(view.sections), RESULTS_MAX)
  const listH = view.note ? NOTE_H : showPane ? Math.max(rowsH, PREVIEW_MIN_H) : rowsH
  // The sheet grows to hold the panel when it has fewer rows than the panel has actions.
  const sheetH = panelOpen ? Math.max(listH, panelHeight(listed) + 2 * SHEET_PAD) : listH
  // Results show with the field, not after the buttons split off.
  const loadingShown = useHeld(view.loading && content && (phase === 'opening' || phase === 'open'), LOADING_AFTER_MS)
  const showResults = content && (phase === 'opening' || phase === 'open') && (view.note !== undefined || flat.length > 0)

  // A new query or scope starts at the top.
  useEffect(() => setSelection(undefined), [query, scope])
  useEffect(() => {
    if (recalled !== undefined && query !== store.history[recalled]) setRecalled(undefined)
  }, [query])
  // The panel belongs to one row: another row, query or scope closes it.
  useEffect(() => setPanel(undefined), [query, scope, current?.id])
  useEffect(() => setConfirming(undefined), [query, scope, current?.id])

  // The sheet's height springs when it grows by more than a row (or on open), and changes at once otherwise.
  const shownH = useRef(0)
  const springHeight = animatesHeight(shownH.current, sheetH)
  useEffect(() => {
    shownH.current = showResults ? sheetH : 0
  }, [showResults, sheetH])

  // A scope's keyword and a space enter it: `clip `, `file `.
  useEffect(() => {
    if (scope !== undefined) return
    const hit = scopeByKeyword(query, scopes)
    if (!hit) return
    setScope(scopes.indexOf(hit.scope))
    setQuery(hit.rest)
  }, [query])

  useEffect(() => {
    if (phase === 'open' || phase === 'opening') regions(layout, showResults ? sheetH : 0)
  }, [phase, showResults, sheetH, top])

  /**
   * Hides at once and runs the action while the launcher fades, once the app in front has the keyboard back; a
   * failure shows in the island. An action that stays (Pin, Delete, Retry) runs in place instead; then the providers
   * are asked again and the selection keeps to its row.
   */
  const runRow = (row: Row | undefined, action = 0) => {
    const run = row?.actions[action] ?? row?.actions[0]
    if (!row || !run) return
    // An action that can't be undone waits for a second ↩ within a few seconds.
    if (run.confirm && confirming !== row.id) {
      setConfirming(row.id)
      setTimeout(() => setConfirming((id) => (id === row.id ? undefined : id)), CONFIRM_MS)
      return
    }
    setConfirming(undefined)
    if (run.stay) {
      const index = flat.indexOf(row)
      if (index >= 0) setSelection({ id: row.id, index })
      setPanel(undefined)
      void (async () => {
        try {
          await run.run()
        } catch (error) {
          showFailure(row, error)
        }
        view.refresh()
      })()
      return
    }
    view.record(row)
    void closeSequence()
    setTimeout(async () => {
      performance.mark('launcher.run')
      try {
        await run.run()
      } catch (error) {
        showFailure(row, error)
      }
    }, HANDOFF_MS)
  }

  useEffect(() => {
    if (phase !== 'opening' && phase !== 'open') return
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        const any = current && (current.actions.length || own.length)
        if (!panel && any) setSelection({ id: current.id, index: selected })
        setPanel((p) => (p || !any ? undefined : { filter: '', selected: 0, mode: { kind: 'filter' } }))
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
      const nth = numberKey(event)
      if (nth !== undefined) {
        event.preventDefault()
        // A scope whose provider takes number keys runs its nth row (Clipboard); elsewhere they pick a scope.
        if (active?.numberKeys) runRow(flat[nth])
        else if (nth < buttonScopes.length) setScope(scope === nth ? undefined : nth)
        return
      }
      // ⌘C copies what's selected in the field, as anywhere; with nothing selected it's the row's (an answer's Copy).
      const field = input.current
      if (event.metaKey && event.key.toLowerCase() === 'c' && field && field.selectionStart !== field.selectionEnd) return
      // The selected row's own shortcuts (⌘. pin, ⌘⌫ delete), ahead of the field's editing keys.
      const shortcut = current ? actionForKey(current.actions, event) : -1
      if (shortcut >= 0) {
        event.preventDefault()
        runRow(current, shortcut)
        return
      }
      const command = actionForKey(own, event)
      if (command >= 0) {
        event.preventDefault()
        runCommand(own[command].command)
        return
      }
      // ↑ in an empty field, before any move, recalls what was typed before; ↓ goes forward again.
      const plainArrow = (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      if (plainArrow && selection === undefined && (query === '' ? event.key === 'ArrowUp' : recalled !== undefined)) {
        const next = recall(store.history, recalled, event.key === 'ArrowUp' ? 1 : -1)
        if (next !== undefined || recalled !== undefined) {
          event.preventDefault()
          setRecalled(next)
          setQuery(next === undefined ? '' : store.history[next])
          return
        }
      }
      const move = moveOf(event)
      if (move) {
        event.preventDefault()
        setSelection(moveTo(flat, view.sections.map((s) => s.rows.length), selection, move))
        return
      }
      if (event.metaKey && event.key === ',') {
        event.preventDefault()
        setSettingsTarget({ page: 'launcher' })
        void closeSequence()
        void call('runtime', 'window.openSettings', {})
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        runRow(current, event.metaKey ? 1 : event.shiftKey ? 2 : 0)
        return
      }
      if (event.key === 'Backspace' && query === '' && scope !== undefined) {
        event.preventDefault()
        setScope(undefined)
        return
      }
      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault()
        if (current && !current.answer && current.id !== 'web') setQuery(current.title)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, query, scope, selection, flat, scopes, panel, panelOpen, listed, store.prefs, store.history, confirming, recalled])

  /** Sets (or clears, with undefined) an alias or hotkey on the selected row. */
  const setItem = (row: Row, change: ItemPrefs) =>
    store.update(
      (prefs) => {
        const item = Object.fromEntries(Object.entries({ ...prefs.items[row.id], ...change }).filter(([, v]) => v !== undefined)) as ItemPrefs
        const { [row.id]: _, ...others } = prefs.items
        return { ...prefs, items: Object.keys(item).length ? { ...others, [row.id]: item } : others }
      },
      [row],
    )

  /** The launcher's own actions on the selected row: alias and hotkey take the panel's line, the others run at once. */
  function runCommand(command: LauncherCommand) {
    const row = current
    if (!row) return
    setSelection({ id: row.id, index: selected })
    if (command === 'alias') return setPanel({ filter: '', selected: 0, mode: { kind: 'alias', draft: store.prefs.items[row.id]?.alias ?? '' } })
    if (command === 'hotkey') return setPanel({ filter: '', selected: 0, mode: { kind: 'hotkey' } })
    if (command === 'favourite') {
      const has = store.prefs.favourites.includes(row.id)
      store.update((prefs) => ({ ...prefs, favourites: has ? prefs.favourites.filter((id) => id !== row.id) : [...prefs.favourites, row.id] }), [row])
    } else store.resetRanking(row.id)
    setPanel(undefined)
  }

  const runListed = (item: ListedAction) => (item.command ? runCommand(item.command) : runRow(current, item.index))

  /** While the panel is open it takes the keys: arrows, Return, Escape, and typing, which goes to its bottom line. */
  function onPanelKey(event: KeyboardEvent) {
    if (!panel || !current) return
    const key = event.key
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey
    const back = () => setPanel((p) => p && { filter: '', selected: 0, mode: { kind: 'filter' } })
    if (panel.mode.kind === 'hotkey') {
      event.preventDefault()
      if (key === 'Escape' && plain) return back()
      if (key === 'Backspace' && plain) {
        setItem(current, { hotkey: undefined })
        return setPanel(undefined)
      }
      const accelerator = acceleratorOf(event)
      if (!accelerator) return
      setItem(current, { hotkey: accelerator })
      return setPanel(undefined)
    }
    if (panel.mode.kind === 'alias') {
      const draft = panel.mode.draft
      if (key === 'Escape') {
        event.preventDefault()
        return back()
      }
      if (key === 'Enter') {
        event.preventDefault()
        setItem(current, { alias: cleanAlias(draft) })
        return setPanel(undefined)
      }
      if (key === 'Backspace') {
        event.preventDefault()
        return setPanel({ ...panel, mode: { kind: 'alias', draft: draft.slice(0, -1) } })
      }
      if (key.length === 1 && plain) {
        event.preventDefault()
        return setPanel({ ...panel, mode: { kind: 'alias', draft: draft + key } })
      }
      if (key === 'Tab') event.preventDefault()
      return
    }
    if (key === 'Escape') {
      event.preventDefault()
      setPanel((p) => (p?.filter ? { ...p, filter: '', selected: 0 } : undefined))
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      if (!listed.length) return
      const step = key === 'ArrowDown' ? 1 : -1
      setPanel((p) => p && { ...p, selected: (p.selected + step + listed.length) % listed.length })
    } else if (key === 'Enter') {
      event.preventDefault()
      const pick = listed[panel.selected]
      if (pick) runListed(pick)
    } else if (key === 'Backspace') {
      event.preventDefault()
      setPanel((p) => p && { ...p, filter: p.filter.slice(0, -1), selected: 0 })
    } else if (!plain && actionForKey(listed.map((l) => l.action), event) >= 0) {
      // An action's own shortcut runs it from the panel too.
      event.preventDefault()
      runListed(listed[actionForKey(listed.map((l) => l.action), event)])
    } else if (key.length === 1 && plain) {
      // Kept out of the search field: it filters the panel instead.
      event.preventDefault()
      setPanel((p) => p && { ...p, filter: p.filter + key, selected: 0 })
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
        style={{ left: layout.rowLeft, top: layout.top, width: fieldW, height: PILL_H, clipPath: fieldClip }}
        initial={{ opacity: 0 }}
        animate={{ opacity: content ? 1 : 0 }}
        transition={{ duration: content ? FIELD_FADE : 0.06, ease: 'easeOut' }}
      >
        <Search className="size-5 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          aria-label="Search"
          value={query}
          placeholder={active ? active.title : layout.pillW >= PLACEHOLDER_PILL_W ? PLACEHOLDER : 'Search…'}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[20px] text-foreground outline-none placeholder:text-[17px] placeholder:text-muted-foreground"
          onChange={(event) => setQuery(event.target.value)}
        />
        {active && (
          <span className="flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
            <Kbd>{`⌘${(scope ?? 0) + 1}`}</Kbd>
          </span>
        )}
      </motion.label>

      {/* A thin bar under the pill while a provider takes longer than a moment. */}
      {loadingShown && (
        <div className="absolute overflow-hidden rounded-full" style={{ left: layout.rowLeft + 26, top: layout.top + PILL_H + 3, width: layout.rowW - 52, height: 1 }}>
          <motion.div
            className="h-full w-1/3 rounded-full bg-muted-foreground"
            initial={{ x: '-100%' }}
            animate={{ x: '300%' }}
            transition={{ duration: 0.9, ease: 'easeInOut', repeat: Infinity }}
          />
        </div>
      )}

      {buttonScopes.map((s, i) => (
        <motion.button
          key={s.id}
          type="button"
          aria-label={`${s.title} ⌘${i + 1}`}
          aria-pressed={scope === i}
          tabIndex={-1}
          className="absolute flex items-center justify-center rounded-full text-muted-foreground ring-1 ring-white/10 ring-inset hover:text-foreground aria-pressed:bg-white/12 aria-pressed:text-white aria-pressed:ring-white/25"
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
          onPointerEnter={() => setHovered(i)}
          onPointerLeave={() => setHovered((h) => (h === i ? undefined : h))}
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
            transition={{ ...SHEET_SPRING, opacity: { duration: FIELD_FADE }, height: springHeight ? SHEET_SPRING : { duration: 0 } }}
          >
            {view.note ? (
              <Note>{view.note}</Note>
            ) : (
              <div className="flex h-full">
                <div className="min-w-0 flex-1">
                  <Results
                    sections={view.sections}
                    selected={selected}
                    onSelect={(i) => !panelOpen && setSelection({ id: flat[i].id, index: i })}
                    onRun={(i) => runRow(flat[i])}
                    compact={showPane}
                    numbered={active?.numberKeys}
                    confirming={confirming === undefined ? undefined : { id: confirming, text: current?.actions.find((a) => a.confirm)?.confirm ?? '' }}
                  />
                </div>
                {showPane && <Preview row={current} />}
              </div>
            )}
            {panelOpen && (
              <ActionPanel
                row={current}
                listed={listed}
                filter={panel.filter}
                mode={panel.mode}
                selected={panel.selected}
                onSelect={(i) => setPanel({ ...panel, selected: i })}
                onRun={runListed}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* What a scope button is, in the notch's own style rather than the system tooltip; over the results when they show. */}
      <AnimatePresence>
        {hovered !== undefined && buttonScopes[hovered] && content && buttonsShown && (
          <motion.div
            key="scope-tip"
            className="pointer-events-none absolute flex items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--island)] px-2.5 py-1.5 text-caption text-foreground ring-1 ring-white/10 ring-inset"
            style={{ left: layout.buttonCx(hovered), top: layout.top + PILL_H + 8, x: '-50%' }}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={QUICK}
          >
            {buttonScopes[hovered].title} <Kbd>{`⌘${hovered + 1}`}</Kbd>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
