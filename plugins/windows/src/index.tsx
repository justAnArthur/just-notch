import { definePlugin, type PluginContext, type Rect, type SearchItem } from '@just-notch/sdk'
import { LayoutPanelLeft } from 'lucide-react'
import { findLayouts, icon, type Layout, place } from './layouts'

/** Where each window was before the plugin first moved it, for Restore; and where it put it last. */
const restore = new Map<string, Rect>()
const placed = new Map<string, Rect>()

const near = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2

async function arrange(layout: Layout, ctx: PluginContext) {
  const win = await ctx.call('windows.front', {})
  const key = `${win.pid}:${win.title}`
  if (layout.op === 'restore') {
    const frame = restore.get(key)
    if (!frame) return
    restore.delete(key)
    placed.delete(key)
    await ctx.call('windows.setFrame', { frame })
    return
  }
  const frame = place(layout, win)
  if (!frame) return
  // A window the user moved since is remembered afresh; one still where the plugin put it keeps its first frame.
  const last = placed.get(key)
  if (!restore.has(key) || !last || !near(last, win.frame)) restore.set(key, win.frame)
  placed.set(key, frame)
  await ctx.call('windows.setFrame', { frame })
}

const item = (layout: Layout, ctx: PluginContext): SearchItem => ({
  id: layout.id,
  title: layout.title,
  subtitle: 'Window Management',
  icon: icon(layout),
  actions: [{ title: 'Move Window', run: () => arrange(layout, ctx) }],
})

export default definePlugin({
  search: {
    title: 'Window Management',
    icon: LayoutPanelLeft,
    keywords: ['window', 'windows', 'win'],
    root: { limit: 4 },
    provide: (query, { ctx }) => findLayouts(query).map((l) => item(l, ctx)),
  },
})
