import { IslandFlash } from '@justanarthur/modo-ui-notch'
import { definePlugin, type FrontWindow, type PluginContext, type Rect, type SearchItem } from '@just-notch/sdk'
import { LayoutPanelLeft, TriangleAlert } from 'lucide-react'
import { COMMANDS, cycleStep, type LastMove } from './commands'
import { STORAGE, startHotkeys } from './hotkeys'
import { findLayouts, icon, type Layout, place } from './layouts'
import Settings from './settings'

/** Where each window was before the plugin first moved it, for Restore; and where it put it last. */
const restore = new Map<string, Rect>()
const placed = new Map<string, Rect>()
let last: LastMove | undefined

const near = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2
const keyOf = (win: FrontWindow) => `${win.pid}:${win.title}`

/** Moves the front window to `pick(win)`; resolves with where it went, or `undefined` when it stayed. */
async function arrange(ctx: PluginContext, pick: (win: FrontWindow) => Layout): Promise<Rect | undefined> {
  const win = await ctx.call('windows.front', {})
  const key = keyOf(win)
  const layout = pick(win)
  if (layout.op === 'restore') {
    const frame = restore.get(key)
    if (!frame) return
    restore.delete(key)
    placed.delete(key)
    await ctx.call('windows.setFrame', { frame })
    return frame
  }
  const frame = place(layout, win)
  if (!frame) return
  // A window the user moved since is remembered afresh; one still where the plugin put it keeps its first frame.
  const prev = placed.get(key)
  if (!restore.has(key) || !prev || !near(prev, win.frame)) restore.set(key, win.frame)
  placed.set(key, frame)
  await ctx.call('windows.setFrame', { frame })
  return frame
}

let cycling = true

async function press(ctx: PluginContext, id: string) {
  const command = COMMANDS.find((c) => c.id === id)!
  let move: Omit<LastMove, 'frame'> | undefined
  try {
    const frame = await arrange(ctx, (win) => {
      const step = cycleStep(last, command, keyOf(win), win.frame, cycling)
      move = { command: command.id, window: keyOf(win), step }
      return command.cycle[step]!
    })
    last = frame && move ? { ...move, frame } : undefined
  } catch (error) {
    last = undefined
    const message = error instanceof Error ? error.message : String(error)
    ctx.activity.flash({ priority: 'hud', key: 'windows', durationMs: 4000, view: () => <IslandFlash tone="warning" icon={<TriangleAlert />} title="Couldn't move the window" caption={message} /> })
  }
}

const item = (layout: Layout, ctx: PluginContext): SearchItem => ({
  id: layout.id,
  title: layout.title,
  subtitle: 'Window Management',
  icon: icon(layout),
  actions: [
    {
      title: 'Move Window',
      run: async () => {
        last = undefined
        await arrange(ctx, () => layout)
      },
    },
  ],
})

export default definePlugin({
  activate(ctx) {
    const stopCycling = ctx.storage.subscribe<boolean>(STORAGE.cycling, (value) => (cycling = value !== false))
    void ctx.storage.get<boolean>(STORAGE.cycling).then((value) => (cycling = value !== false))
    const stopHotkeys = startHotkeys(ctx, (id) => void press(ctx, id))
    return () => {
      stopCycling()
      stopHotkeys()
    }
  },
  settings: Settings,
  search: {
    title: 'Window Management',
    icon: LayoutPanelLeft,
    keywords: ['window', 'windows', 'win'],
    root: { limit: 4 },
    provide: (query, { ctx }) => findLayouts(query).map((l) => item(l, ctx)),
  },
})
