import { useEffect, useRef } from 'react'
import { bestScore } from './match'
import type { Row, RowAction } from './rows'
import { SHEET_PAD, SHEET_RADIUS } from './results'
import { formatAccelerator } from './shortcut'

/** The keys that run a row's first actions without the panel; the panel shows them beside those actions. */
export const ACTION_KEYS = ['↩', '⌘↩', '⇧↩']

/** The key the panel shows beside an action: ↩, ⌘↩, ⇧↩ for the first three, else its own shortcut. */
export const actionKey = (action: RowAction, index: number): string | undefined =>
  ACTION_KEYS[index] ?? (action.shortcut ? formatAccelerator(action.shortcut) : undefined)

export const PANEL_W = 280
const PANEL_ROW_H = 34
const PANEL_HEADER_H = 32
const PANEL_PAD = 6
const PANEL_RADIUS = SHEET_RADIUS - SHEET_PAD
const PANEL_ROW_RADIUS = PANEL_RADIUS - PANEL_PAD

export interface ListedAction {
  action: RowAction
  /** Its place in the row's actions, which picks its key. */
  index: number
}

/** The row's actions that match what was typed in the panel, best first; all of them, in order, when nothing was. */
export function filterActions(actions: RowAction[], filter: string): ListedAction[] {
  const listed = actions.map((action, index) => ({ action, index }))
  const q = filter.trim()
  if (!q) return listed
  return listed
    .map((a) => ({ ...a, score: bestScore(q, a.action.title) }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
}

/** The panel's height for this many actions; the sheet grows to hold it. */
export const panelHeight = (count: number) => PANEL_PAD * 2 + PANEL_HEADER_H + Math.max(count, 1) * PANEL_ROW_H

interface ActionPanelProps {
  row: Row
  listed: ListedAction[]
  filter: string
  selected: number
  onSelect: (index: number) => void
  onRun: (action: number) => void
}

/** Every action of the selected row (⌘K), at the sheet's bottom right, as Raycast puts it. Typing filters it. */
export function ActionPanel({ row, listed, filter, selected, onSelect, onRun }: ActionPanelProps) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div
      role="dialog"
      aria-label={`Actions for ${row.title}`}
      className="absolute bg-surface-2 text-foreground shadow-2xl ring-1 ring-white/10 ring-inset"
      style={{ right: SHEET_PAD, bottom: SHEET_PAD, width: PANEL_W, height: panelHeight(listed.length), padding: PANEL_PAD, borderRadius: PANEL_RADIUS }}
    >
      <p className="flex items-center gap-2 truncate px-2.5 text-caption text-muted-foreground" style={{ height: PANEL_HEADER_H }}>
        {filter ? <span className="truncate text-foreground">{filter}</span> : <span className="truncate">{row.answer ? 'Actions' : row.title}</span>}
      </p>
      <div ref={list} role="listbox" aria-label="Actions">
        {listed.length === 0 && (
          <p className="flex items-center px-2.5 text-muted-foreground" style={{ height: PANEL_ROW_H }}>
            No actions match.
          </p>
        )}
        {listed.map(({ action, index }, i) => {
          const active = i === selected
          return (
            <div
              key={`${index}:${action.title}`}
              role="option"
              aria-selected={active}
              data-selected={active || undefined}
              className="flex cursor-default items-center gap-3 px-2.5 aria-selected:bg-surface-3"
              style={{ height: PANEL_ROW_H, borderRadius: PANEL_ROW_RADIUS }}
              onPointerMove={() => !active && onSelect(i)}
              onClick={() => onRun(index)}
            >
              <span className="min-w-0 flex-1 truncate">{action.title}</span>
              {actionKey(action, index) && <span className="shrink-0 text-caption text-muted-foreground">{actionKey(action, index)}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
