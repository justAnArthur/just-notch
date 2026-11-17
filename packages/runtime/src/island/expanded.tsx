import type { ScreenGeometry } from '@just-notch/bridge-schema'
import { Button, SizeProvider } from '@justanarthur/modo-ui'
import { Puzzle, Settings as SettingsIcon } from 'lucide-react'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type ActivityEntry, SETTINGS_TAB, type Snap } from '../activity/reducer'
import { dispatch, useActivityState } from '../activity/store'
import { type LoadedPlugin, usePlugins } from '../plugins/loader'
import PluginView from '../plugins/plugin-view'
import Settings from '../settings/settings'
import { useEdgeFade } from './edge-fade'
import { type Shape, stripLayout } from './geometry'
import TabStrip, { type Tab } from './tabs'

/** Moves the selection `delta` tabs, round from settings back to the first; true when it moved. */
export type TabStep = (delta: number) => boolean

/** Arrows move a caret, a value or a menu's focus there, not the tab. */
const OWN_ARROWS = 'input, textarea, select, [contenteditable], [role=slider], [data-base-ui-portal]'

interface ExpandedProps {
  primary?: ActivityEntry
  shape: Shape
  geometry: ScreenGeometry
  /** Set while mounted, for the swipe gestures. */
  step: RefObject<TabStep | null>
  /** The content's own height at the first snap, for the island to fit it. */
  onFit: (height: number) => void
}

/** Reports `ref`'s height as it changes. */
function useHeight(ref: RefObject<HTMLElement | null>, onHeight: (height: number) => void, active: boolean) {
  const report = useRef(onHeight)
  report.current = onHeight
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !active) return
    report.current(el.getBoundingClientRect().height)
    const observer = new ResizeObserver(([entry]) => entry && report.current(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, active])
}

/** The primary activity's view, then every other plugin's widget. */
function tabsOf(primary: ActivityEntry | undefined, plugins: LoadedPlugin[]): Tab[] {
  const tabs: Tab[] = []
  const activityView = primary?.spec.expanded
  if (primary && activityView) {
    const owner = plugins.find((p) => p.installed.manifest.id === primary.plugin)
    tabs.push({
      id: `activity:${primary.plugin}`,
      plugin: primary.plugin,
      label: primary.spec.title ?? owner?.installed.manifest.name ?? primary.plugin,
      icon: owner?.definition.widget?.icon ?? Puzzle,
      view: activityView,
    })
  }
  for (const { installed, definition } of plugins) {
    const { id } = installed.manifest
    if (!definition.widget || tabs[0]?.plugin === id) continue
    tabs.push({ id: `widget:${id}`, plugin: id, label: definition.widget.title, icon: definition.widget.icon ?? Puzzle, view: definition.widget.view })
  }
  return tabs
}

/**
 * The open island: icon tabs in both wings around the notch and settings at the far right, the tab's title
 * (or the hovered tab's, as a preview), and its view. On the first snap the island fits the view (it scrolls
 * past the snap's cap); on the tall snap the view fills it. Settings is a page of its own, on the tall snap.
 */
export default function Expanded({ primary, shape, geometry, step, onFit }: ExpandedProps) {
  const plugins = usePlugins()
  const { tab: selected, snap } = useActivityState()
  const [hovered, setHovered] = useState<number | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)

  const tabs = tabsOf(primary, plugins)
  const settings = selected === SETTINGS_TAB
  const found = tabs.findIndex((t) => t.id === selected)
  const index = settings ? -1 : Math.max(0, found)
  const tab = tabs[index]
  const title = (hovered !== null ? tabs[hovered]?.label : undefined) ?? (settings ? 'Settings' : tab?.label)
  const layout = stripLayout(tabs.length, shape.w, geometry)
  const fills: boolean = settings || (snap as Snap) === 1
  useEdgeFade(content, 'y', settings ? SETTINGS_TAB : tab?.id)
  useHeight(measure, onFit, !fills)

  const select = (id: string | undefined) => id && dispatch({ type: 'tab', tab: id })
  // Swipes and arrows go round: the widgets, then settings, then back to the first widget.
  const order = [...tabs.map((t) => t.id), SETTINGS_TAB]
  const move: TabStep = (delta) => {
    const at = order.indexOf(settings ? SETTINGS_TAB : (tab?.id ?? SETTINGS_TAB))
    select(order[(at + delta + order.length) % order.length])
    return true
  }
  useEffect(() => {
    step.current = move
    return () => {
      step.current = null
    }
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest(OWN_ARROWS)) return
      event.preventDefault()
      step.current?.(event.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  return (
    <div className="absolute inset-0 flex flex-col">
      <SizeProvider size="compact">
        <div className="flex shrink-0 items-center px-3" style={{ height: geometry.notch.h }}>
          {tabs.length > 0 ? (
            <TabStrip tabs={tabs} selected={index} layout={layout} onSelect={(i) => select(tabs[i]?.id)} onHover={setHovered} />
          ) : (
            <div className="flex-1" />
          )}
          <div className="flex shrink-0 items-center pl-1">
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label="Settings"
              aria-pressed={settings}
              className={settings ? 'text-foreground' : undefined}
              onClick={() => (settings ? select(tabs[0]?.id) : select(SETTINGS_TAB))}
            >
              <SettingsIcon size={14} strokeWidth={settings ? 2 : 1.5} />
            </Button>
          </div>
        </div>
      </SizeProvider>
      {/* The bottom inset matches the sides' (INSET), so the content sits evenly in the outline. */}
      <div className="flex min-h-0 flex-1 flex-col pb-5">
        <div className="flex h-6 shrink-0 items-end px-5">
          <span data-island-title className="truncate text-caption weight-medium text-muted-foreground">
            {title}
          </span>
        </div>
        <div
          ref={content}
          data-island-content
          className="edge-fade edge-fade-y relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pt-2 scrollbar-hide"
        >
          <div ref={measure} className={fills ? 'h-full' : undefined}>
            {settings ? (
              <Settings />
            ) : tab ? (
              <PluginView key={tab.id} plugin={tab.plugin} view={tab.view} />
            ) : (
              <div className="flex h-24 items-center justify-center text-caption text-muted-foreground">Nothing here yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
