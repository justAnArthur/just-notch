import { Puzzle } from 'lucide-react'
import type { ActivityEntry } from '../activity/reducer'
import type { LoadedPlugin } from '../plugins/loader'
import type { Tab } from './tabs'

/** The built-in tabs' order, most glanced at first; any other plugin follows in the host's order. */
const BUILT_IN_ORDER = ['now-playing', 'calendar', 'weather', 'clipboard', 'recent-files', 'clock', 'system']

const rank = (id: string) => {
  const at = BUILT_IN_ORDER.indexOf(id)
  return at < 0 ? BUILT_IN_ORDER.length : at
}

/**
 * One tab per plugin, in a fixed order, so an icon never moves under the pointer when an activity starts
 * or ends. A plugin's tab shows its widget whether or not it runs an activity (one view per tab); only a plugin with
 * no widget gets its primary activity's view, as a tab of its own while the activity lasts.
 */
export function tabsOf(primary: ActivityEntry | undefined, plugins: LoadedPlugin[]): Tab[] {
  const tabs: Tab[] = []
  const ordered = plugins.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.installed.manifest.id) - rank(b.p.installed.manifest.id) || a.i - b.i)
  for (const { installed, definition } of ordered.map(({ p }) => p)) {
    const { id, name } = installed.manifest
    const { widget } = definition
    if (widget) tabs.push({ id: `widget:${id}`, plugin: id, label: widget.title, icon: widget.icon ?? Puzzle, view: widget.view })
    else if (primary?.plugin === id && primary.spec.expanded)
      tabs.push({ id: `activity:${id}`, plugin: id, label: primary.spec.title ?? name, icon: Puzzle, view: primary.spec.expanded })
  }
  return tabs
}

/** Tabs last seen showing only an empty state (a view marks it with `data-island-empty`); a tab not seen yet counts as full. */
const emptyTabs = new Set<string>()

/** Notes whether `tab` showed only its empty state, for the next open. */
export function rememberEmpty(tab: string, empty: boolean) {
  if (empty) emptyTabs.add(tab)
  else emptyTabs.delete(tab)
}

/**
 * The tab the island opens on: the primary activity's, else the last one shown if it has content, else the first
 * with content, else the first.
 */
export function openingTab(tabs: Tab[], last: string | null, primary?: ActivityEntry): string | undefined {
  const own = primary && tabs.find((t) => t.plugin === primary.plugin)
  if (own) return own.id
  const full = (t: Tab) => !emptyTabs.has(t.id)
  const previous = tabs.find((t) => t.id === last)
  return (previous && full(previous) ? previous : (tabs.find(full) ?? tabs[0]))?.id
}
