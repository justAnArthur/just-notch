import type { ScreenGeometry } from '@just-notch/bridge-schema'
import { Button, SizeProvider, TabsSubtle } from '@justanarthur/modo-ui'
import { Settings } from 'lucide-react'
import { type ComponentType, useState } from 'react'
import type { ActivityEntry } from '../activity/reducer'
import { call } from '../host/client'
import { usePlugins } from '../plugins/loader'
import PluginView from '../plugins/plugin-view'
import type { Shape } from './geometry'

interface Tab {
  id: string
  plugin: string
  label: string
  view: ComponentType
}

interface ExpandedProps {
  primary?: ActivityEntry
  shape: Shape
  geometry: ScreenGeometry
}

/** The open island: a tab strip beside the notch (the primary activity, then every widget), the selected view below. */
export default function Expanded({ primary, shape, geometry }: ExpandedProps) {
  const plugins = usePlugins()
  const [selected, setSelected] = useState<string>()

  const tabs: Tab[] = []
  const activityView = primary?.spec.expanded
  if (primary && activityView) {
    const name = plugins.find((p) => p.installed.manifest.id === primary.plugin)?.installed.manifest.name ?? primary.plugin
    tabs.push({ id: `activity:${primary.plugin}`, plugin: primary.plugin, label: name, view: activityView })
  }
  for (const { installed, definition } of plugins) {
    if (definition.widget) tabs.push({ id: `widget:${installed.manifest.id}`, plugin: installed.manifest.id, label: definition.widget.title, view: definition.widget.view })
  }
  const index = Math.max(0, tabs.findIndex((t) => t.id === selected))
  const tab = tabs[index]
  const side = (shape.w - geometry.notch.w) / 2

  return (
    <div className="absolute inset-0 flex flex-col">
      <SizeProvider size="compact">
        <div className="flex shrink-0 items-center justify-between" style={{ height: geometry.notch.h + 4 }}>
          <div className="flex min-w-0 items-center overflow-hidden pl-4" style={{ width: side }}>
            {tabs.length > 1 && (
              <TabsSubtle selectedIndex={index} onSelect={(i) => setSelected(tabs[i]?.id)}>
                {tabs.map((t, i) => (
                  <TabsSubtle.Item key={t.id} index={i} label={t.label} />
                ))}
              </TabsSubtle>
            )}
            {tabs.length === 1 && <span className="truncate text-caption text-muted-foreground">{tabs[0].label}</span>}
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
