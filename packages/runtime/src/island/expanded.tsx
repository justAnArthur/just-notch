import type { ScreenGeometry } from '@just-notch/bridge-schema'
import { Button, SizeProvider } from '@justanarthur/modo-ui'
import { Puzzle, Settings } from 'lucide-react'
import { type MutableRefObject, useEffect, useRef, useState } from 'react'
import type { ActivityEntry } from '../activity/reducer'
import { call } from '../host/client'
import { type LoadedPlugin, usePlugins } from '../plugins/loader'
import PluginView from '../plugins/plugin-view'
import { useEdgeFade } from './edge-fade'
import { type Shape, stripLayout } from './geometry'
import TabStrip, { type Tab } from './tabs'

/** Moves the selection `delta` tabs; false at either end. */
export type TabStep = (delta: number) => boolean

/** Arrows move a caret, a value or a menu's focus there, not the tab. */
const OWN_ARROWS = 'input, textarea, select, [contenteditable], [role=slider], [data-base-ui-portal]'

interface ExpandedProps {
  primary?: ActivityEntry
  shape: Shape
  geometry: ScreenGeometry
  /** Set while mounted, for the swipe gestures. */
  step: MutableRefObject<TabStep | null>
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
 * (or the hovered tab's, as a preview), and its view in a fixed area that scrolls when the view is taller.
 */
export default function Expanded({ primary, shape, geometry, step }: ExpandedProps) {
  const plugins = usePlugins()
  const [selected, setSelected] = useState<string>()
  const [hovered, setHovered] = useState<number | null>(null)
  const content = useRef<HTMLDivElement>(null)

  const tabs = tabsOf(primary, plugins)
  const index = Math.max(0, tabs.findIndex((t) => t.id === selected))
  const tab = tabs[index]
  const title = tabs[hovered ?? index]?.label ?? tab?.label
  const layout = stripLayout(tabs.length, shape.w, geometry)
  useEdgeFade(content, 'y', tab?.id)

  const move: TabStep = (delta) => {
    const next = tabs[index + delta]
    if (!next) return false
    setSelected(next.id)
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
        <div className="flex shrink-0 items-center px-5" style={{ height: geometry.notch.h }}>
          {tabs.length > 0 ? (
            <TabStrip tabs={tabs} selected={index} layout={layout} onSelect={(i) => setSelected(tabs[i]?.id)} onHover={setHovered} />
          ) : (
            <div className="flex-1" />
          )}
          <div className="flex shrink-0 items-center pl-1">
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label="Settings"
              onClick={() => void call('runtime', 'window.openSettings', {}).catch(() => {})}
            >
              <Settings size={14} strokeWidth={1.5} />
            </Button>
          </div>
        </div>
      </SizeProvider>
      <div className="flex min-h-0 flex-1 flex-col pb-3">
        <div className="flex h-6 shrink-0 items-end px-5">
          <span data-island-title className="truncate text-caption weight-medium text-muted-foreground">
            {title}
          </span>
        </div>
        <div
          ref={content}
          data-island-content
          className="edge-fade edge-fade-y relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-1 scrollbar-hide"
        >
          {tab ? (
            <PluginView key={tab.id} plugin={tab.plugin} view={tab.view} />
          ) : (
            <div className="flex size-full items-center justify-center text-caption text-muted-foreground">Nothing here yet</div>
          )}
        </div>
      </div>
    </div>
  )
}
