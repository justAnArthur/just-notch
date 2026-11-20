import type { FrontWindow, Rect } from '@just-notch/sdk'

interface Entry {
  title: string
  /** Where the window was before the plugin first moved it. */
  original: Rect
  /** Where the plugin left it last. */
  placed: Rect
}

const near = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.w - b.w) <= 2 && Math.abs(a.h - b.h) <= 2

/**
 * Each window's frame from before the plugin moved it, for Restore. A window is found by where the plugin left it
 * (titles change: a browser switching tabs), else by its title.
 */
export class RestoreMemory {
  private byApp = new Map<number, Entry[]>()

  private find(win: FrontWindow): Entry | undefined {
    const entries = this.byApp.get(win.pid) ?? []
    return entries.find((e) => near(e.placed, win.frame)) ?? entries.find((e) => e.title === win.title)
  }

  /** The plugin moved `win` to `placed`. A window the user moved since the last time is remembered afresh. */
  moved(win: FrontWindow, placed: Rect) {
    const entries = this.byApp.get(win.pid) ?? []
    this.byApp.set(win.pid, entries)
    const entry = this.find(win)
    if (entry && near(entry.placed, win.frame)) {
      entry.placed = placed
      entry.title = win.title
      return
    }
    if (entry) entries.splice(entries.indexOf(entry), 1)
    entries.push({ title: win.title, original: win.frame, placed })
  }

  /** The frame to restore `win` to, forgotten once taken; `undefined` when the plugin never moved it. */
  take(win: FrontWindow): Rect | undefined {
    const entry = this.find(win)
    if (!entry) return undefined
    const entries = this.byApp.get(win.pid)!
    entries.splice(entries.indexOf(entry), 1)
    return entry.original
  }
}
