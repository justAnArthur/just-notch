import { IslandFlash } from '@justanarthur/modo-ui-notch'
import { Button } from '@justanarthur/modo-ui'
import { definePlugin, type FrontApp, type FrontWindow, type PluginContext, type Rect, type SearchItem } from '@just-notch/sdk'
import { LayoutPanelLeft, Scaling, TriangleAlert } from 'lucide-react'
import { COMMANDS, cycleStep, type LastMove } from './commands'
import { pause, STORAGE, startHotkeys } from './hotkeys'
import { anchorRefused, screenOf } from './displays'
import { findLayouts, icon, type Layout, place } from './layouts'
import { RestoreMemory } from './restore'
import Settings from './settings'
import { DESKTOP_SETTINGS, TILING_CAPTION, TILING_TITLE, tilingOn } from './tiling'

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
    await ctx.call('windows.setFrame', { frame, animate: prefs.animate })
    return frame
  }
  const asked = place(layout, win)
  if (!asked) return
  await ctx.call('windows.setFrame', { frame: asked, animate: prefs.animate })
  const after = await ctx.call('windows.front', {})
  const screen = screenOf(asked, win.screens)
  const anchored = screen && anchorRefused(asked, after.frame, screen)
  let frame = after.frame
  if (anchored) {
    if (anchored.x !== after.frame.x || anchored.y !== after.frame.y) await ctx.call('windows.setFrame', { frame: anchored, animate: prefs.animate })
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

const prefs = { cycling: true, animate: true, ignored: [] as string[] }

async function press(ctx: PluginContext, id: string) {
  const command = COMMANDS.find((c) => c.id === id)!
  let move: Omit<LastMove, 'frame'> | undefined
  try {
    const frame = await arrange(ctx, (win) => {
      const step = cycleStep(last, command, keyOf(win), win.frame, prefs.cycling)
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

/** Reads `key` now and on every change. */
function follow<T>(ctx: PluginContext, key: string, cb: (value: T | undefined) => void): () => void {
  void ctx.storage.get<T>(key).then(cb)
  return ctx.storage.subscribe<T>(key, cb)
}

/** Once, the first time hotkeys run while macOS's own tiling is on: say so, with the way to its switches. */
async function noticeTiling(ctx: PluginContext) {
  if ((await ctx.storage.get<boolean>(STORAGE.tilingNoticed)) || (await ctx.storage.get<boolean>(STORAGE.enabled)) === false) return
  if (!tilingOn(await ctx.call('windows.tiling', {}))) return
  await ctx.storage.set(STORAGE.tilingNoticed, true)
  ctx.activity.flash({
    priority: 'hud',
    key: 'windows.tiling',
    durationMs: 8000,
    view: () => (
      <IslandFlash
        icon={<LayoutPanelLeft />}
        title={TILING_TITLE}
        caption={TILING_CAPTION}
        action={
          <Button variant="ghost" size="compact" onClick={() => void ctx.call('system.openUrl', { url: DESKTOP_SETTINGS })}>
            Open
          </Button>
        }
      />
    ),
  })
}

export default definePlugin({
  activate(ctx) {
    let front: FrontApp | null = null
    const ignore = () => pause('ignored', !!front && prefs.ignored.includes(front.bundleId))
    const stops = [
      follow<boolean>(ctx, STORAGE.cycling, (v) => (prefs.cycling = v !== false)),
      follow<boolean>(ctx, STORAGE.animate, (v) => (prefs.animate = v !== false)),
      follow<string[]>(ctx, STORAGE.ignoredApps, (v) => {
        prefs.ignored = v ?? []
        ignore()
      }),
      ctx.subscribe('frontApp', (app) => {
        front = app
        ignore()
      }),
      startHotkeys(ctx, (id) => void press(ctx, id)),
    ]
    void noticeTiling(ctx).catch(() => {})
    return () => {
      for (const stop of stops) stop()
      pause('ignored', false)
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
