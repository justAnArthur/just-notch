import type { ScreenGeometry } from '@just-notch/bridge-schema'
import type { IconProps } from '@just-notch/sdk'
import { Button, ScrollArea, SizeProvider, TabsSubtle } from '@justanarthur/modo-ui'
import { Puzzle, Settings } from 'lucide-react'
import { type ComponentType, useEffect, useRef, useState } from 'react'
import type { ActivityEntry } from '../activity/reducer'
import { call } from '../host/client'
import { usePlugins } from '../plugins/loader'
import PluginView from '../plugins/plugin-view'
import type { Shape } from './geometry'

interface Tab {
  id: string
  plugin: string
  label: string
  icon: ComponentType<IconProps>
  view: ComponentType
}

interface ExpandedProps {
  primary?: ActivityEntry
  shape: Shape
  geometry: ScreenGeometry
}

/**
 * The open island: a tab strip beside the notch (the primary activity, then every other plugin's widget), the selected view below.
 * Tabs are icons with only the selected one labelled, so eight fit beside the notch; past that the strip scrolls.
 */
export default function Expanded({ primary, shape, geometry }: ExpandedProps) {
  const plugins = usePlugins()
  const [selected, setSelected] = useState<string>()
  const strip = useRef<HTMLDivElement>(null)

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
  const index = Math.max(0, tabs.findIndex((t) => t.id === selected))
  const tab = tabs[index]
  const side = (shape.w - geometry.notch.w) / 2

  // Scrolls only the strip: scrollIntoView would also scroll the page under the island.
  useEffect(() => {
    const viewport = strip.current?.querySelector<HTMLElement>('[data-slot=scroll-area-viewport]')
    const active = viewport?.querySelector('[role=tab][aria-selected=true]')
    if (!viewport || !active) return
    const view = viewport.getBoundingClientRect()
    const rect = active.getBoundingClientRect()
    if (rect.left < view.left) viewport.scrollLeft -= view.left - rect.left
    else if (rect.right > view.right) viewport.scrollLeft += rect.right - view.right
  }, [index, tabs.length])

  return (
    <div className="absolute inset-0 flex flex-col">
      <SizeProvider size="compact">
        <div className="flex shrink-0 items-center justify-between" style={{ height: geometry.notch.h + 4 }}>
          <div ref={strip} className="flex h-full min-w-0 items-center pl-3" style={{ width: side }}>
            {tabs.length > 1 && (
              <ScrollArea orientation="horizontal" className="min-w-0 [&_[data-slot=scroll-area-scrollbar]]:hidden" viewportClassName="scroll-fade-x ![--scroll-fade-size:20px]">
                <TabsSubtle className="w-max" activeLabel selectedIndex={index} onSelect={(i) => setSelected(tabs[i]?.id)}>
                  {tabs.map((t, i) => (
                    <TabsSubtle.Item key={t.id} index={i} label={t.label} icon={t.icon} />
                  ))}
                </TabsSubtle>
              </ScrollArea>
            )}
            {tabs.length === 1 && <span className="truncate pl-1 text-caption text-muted-foreground">{tabs[0].label}</span>}
          </div>
          <div className="flex items-center justify-end pr-3" style={{ width: side }}>
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
      <div className="relative min-h-0 flex-1 px-6 pt-2 pb-5">
        {tab ? (
          <PluginView key={tab.id} plugin={tab.plugin} view={tab.view} />
        ) : (
          <div className="flex size-full items-center justify-center text-caption text-muted-foreground">Nothing here yet</div>
        )}
      </div>
    </div>
  )
}
