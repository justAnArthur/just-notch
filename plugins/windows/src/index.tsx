import { IslandFlash } from '@justanarthur/modo-ui-notch'
import { definePlugin, type FrontWindow, type PluginContext, type Rect, type SearchItem } from '@just-notch/sdk'
import { LayoutPanelLeft, Scaling, TriangleAlert } from 'lucide-react'
import { COMMANDS, cycleStep, type LastMove } from './commands'
import { STORAGE, startHotkeys } from './hotkeys'
import { anchorRefused, screenOf } from './displays'
import { findLayouts, icon, type Layout, place } from './layouts'
import { RestoreMemory } from './restore'
import Settings from './settings'

const memory = new RestoreMemory()
let last: LastMove | undefined

const keyOf = (win: FrontWindow) => `${win.pid}:${win.title}`

/**
 * Moves the front window to `pick(win)`; resolves with where it went, or `undefined` when it stayed. An app that
 * keeps its window larger than asked gets it pushed back against the edges the layout touched, with a notice.
 */
async function arrange(ctx: PluginContext, pick: (win: FrontWindow) => Layout): Promise<Rect | undefined> {
  const win = await ctx.call('windows.front', {})
  const layout = pick(win)
  if (layout.op === 'restore') {
    const frame = memory.take(win)
    if (!frame) return
    await ctx.call('windows.setFrame', { frame })
    return frame
  }
  const asked = place(layout, win)
  if (!asked) return
  await ctx.call('windows.setFrame', { frame: asked })
  const after = await ctx.call('windows.front', {})
  const screen = screenOf(asked, win.screens)
  const anchored = screen && anchorRefused(asked, after.frame, screen)
  let frame = after.frame
  if (anchored) {
    if (anchored.x !== after.frame.x || anchored.y !== after.frame.y) await ctx.call('windows.setFrame', { frame: anchored })
    frame = anchored
    ctx.activity.flash({
      priority: 'hud',
      key: 'windows',
      durationMs: 2500,
      view: () => <IslandFlash tone="info" icon={<Scaling />} title={`${win.app || 'The app'} won't go smaller`} caption={`Its window stays ${Math.round(frame.w)} × ${Math.round(frame.h)}`} />,
    })
  }
  memory.moved(win, frame)
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
