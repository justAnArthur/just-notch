import type { Rect } from '@just-notch/sdk'
import { type Layout, layout, part, T } from './layouts'

/** A layout with a global hotkey. Rectangle's ⌃⌥ map, so its users keep their muscle memory. */
export interface Command {
  id: string
  title: string
  accelerator: string
  /** What each press in a row places, while cycling is on; the first is the command itself. */
  cycle: Layout[]
}

const command = (id: string, accelerator: string, cycle: Layout[] = [layout(id)]): Command => ({ id, title: layout(id).title, accelerator, cycle })

const topTwoThirds = part('top-two-thirds', 'Top Two Thirds', 0, 0, 1, 2 * T)
const topThird = part('top-third', 'Top Third', 0, 0, 1, T)
const bottomTwoThirds = part('bottom-two-thirds', 'Bottom Two Thirds', 0, T, 1, 2 * T)
const bottomThird = part('bottom-third', 'Bottom Third', 0, 2 * T, 1, T)

export const COMMANDS: Command[] = [
  command('left-half', 'Control+Alt+Left', [layout('left-half'), layout('first-two-thirds'), layout('first-third')]),
  command('right-half', 'Control+Alt+Right', [layout('right-half'), layout('last-two-thirds'), layout('last-third')]),
  command('top-half', 'Control+Alt+Up', [layout('top-half'), topTwoThirds, topThird]),
  command('bottom-half', 'Control+Alt+Down', [layout('bottom-half'), bottomTwoThirds, bottomThird]),
  command('top-left-quarter', 'Control+Alt+U'),
  command('top-right-quarter', 'Control+Alt+I'),
  command('bottom-left-quarter', 'Control+Alt+J'),
  command('bottom-right-quarter', 'Control+Alt+K'),
  command('first-third', 'Control+Alt+D', [layout('first-third'), layout('center-third'), layout('last-third')]),
  command('center-third', 'Control+Alt+F'),
  command('last-third', 'Control+Alt+G', [layout('last-third'), layout('center-third'), layout('first-third')]),
  command('first-two-thirds', 'Control+Alt+E'),
  command('last-two-thirds', 'Control+Alt+T'),
  command('maximize', 'Control+Alt+Enter'),
  command('almost-maximize', 'Control+Alt+Shift+Enter'),
  command('center', 'Control+Alt+C'),
  command('restore', 'Control+Alt+Backspace'),
  command('nextDisplay', 'Control+Alt+Command+Right'),
  command('previousDisplay', 'Control+Alt+Command+Left'),
]

/** The last hotkey move, to tell a repeated press from a new one. */
export interface LastMove {
  command: string
  window: string
  step: number
  /** Where it put the window. */
  frame: Rect
}

/**
 * Which step of `command`'s cycle a press places: the next one when the same command last moved this same window
 * and the window is still where it went, else the first. Only the origin is compared: apps such as Terminal round
 * the size to their grid, but keep the corner.
 */
export function cycleStep(last: LastMove | undefined, command: Command, window: string, frame: Rect, cycling: boolean): number {
  if (!cycling || command.cycle.length < 2 || !last) return 0
  if (last.command !== command.id || last.window !== window) return 0
  if (Math.abs(last.frame.x - frame.x) > 2 || Math.abs(last.frame.y - frame.y) > 2) return 0
  return (last.step + 1) % command.cycle.length
}

/** Each command's accelerator: the user's binding if set (`null` turns it off), else the default. */
export function bindings(overrides: Record<string, string | null> | undefined): Map<string, string | null> {
  return new Map(COMMANDS.map((c) => [c.id, overrides && c.id in overrides ? overrides[c.id]! : c.accelerator]))
}
