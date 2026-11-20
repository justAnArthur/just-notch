import type { IconProps } from '@just-notch/sdk'
import { AtSign, History, Keyboard, Star, StarOff } from 'lucide-react'
import { type ComponentType, useEffect, useRef } from 'react'
import { bestScore } from './match'
import { keepable, type LauncherPrefs } from './prefs'
import { SHEET_PAD } from './results'
import type { Row, RowAction } from './rows'
import { formatAccelerator } from './shortcut'

/** The keys that run a row's first actions without the panel; the panel shows them beside those actions. */
export const ACTION_KEYS = ['↩', '⌘↩', '⇧↩']

/** The key the panel shows beside an action: ↩, ⌘↩, ⇧↩ for the first three (or its own ↩ variant), else its own shortcut. */
export const actionKey = (action: { shortcut?: string }, index: number): string | undefined =>
  // An own ↩ variant (⌥↩ Copy Expression) shows instead of the place's; any other own key shows after ↩, ⌘↩, ⇧↩.
  (action.shortcut?.endsWith('+Enter') ? formatAccelerator(action.shortcut) : ACTION_KEYS[index]) ?? (action.shortcut ? formatAccelerator(action.shortcut) : undefined)

export const PANEL_W = 300
const PANEL_ROW_H = 34
const PANEL_HEADER_H = 32
const PANEL_DIVIDER_H = 9
const PANEL_SEARCH_H = 36
const PANEL_PAD = 6
const PANEL_RADIUS = 12
const PANEL_ROW_RADIUS = PANEL_RADIUS - PANEL_PAD

/** What the launcher itself does to any result it can keep: under a divider at the panel's end. */
export type LauncherCommand = 'alias' | 'hotkey' | 'favourite' | 'reset'

export interface LauncherAction {
  command: LauncherCommand
  title: string
  icon: ComponentType<IconProps>
  shortcut?: string
}

/** The fixed group for `row`: alias, hotkey, favourite, reset ranking. None for the web search, answers or errors. */
export function launcherActions(row: Row, prefs: LauncherPrefs): LauncherAction[] {
  if (!keepable(row)) return []
  const item = prefs.items[row.id]
  const favourite = prefs.favourites.includes(row.id)
  return [
    { command: 'alias', title: item?.alias ? `Edit Alias “${item.alias}”…` : 'Add Alias…', icon: AtSign, shortcut: 'Command+Shift+A' },
    { command: 'hotkey', title: item?.hotkey ? `Change Hotkey ${formatAccelerator(item.hotkey)}…` : 'Assign Hotkey…', icon: Keyboard, shortcut: 'Command+Shift+H' },
    { command: 'favourite', title: favourite ? 'Remove from Favourites' : 'Add to Favourites', icon: favourite ? StarOff : Star, shortcut: 'Command+Shift+F' },
    { command: 'reset', title: 'Reset Ranking', icon: History },
  ]
}

/** One line of the panel: a row's own action (by its place in the row's actions) or one of the launcher's. */
export type ListedAction = { action: RowAction; index: number; command?: undefined } | { action: LauncherAction; index: -1; command: LauncherCommand }

/** The panel's lines that match what was typed in it, best first; all of them, in order (the launcher's last), when nothing was. */
export function filterActions(actions: RowAction[], filter: string, own: LauncherAction[] = []): ListedAction[] {
  const listed: ListedAction[] = [
    ...actions.map((action, index) => ({ action, index })),
    ...own.map((action) => ({ action, index: -1 as const, command: action.command })),
  ]
  const q = filter.trim()
  if (!q) return listed
  return listed
    .map((a) => ({ a, score: bestScore(q, a.action.title) }))
    .filter((a) => a.score > 0)
    .sort((x, y) => y.score - x.score)
    .map(({ a }) => a)
}

/** The panel's height for its lines; the sheet grows to hold it. */
export const panelHeight = (listed: ListedAction[]) => {
  const divided = listed.some((a) => a.command) && listed.some((a) => !a.command)
  return PANEL_PAD * 2 + PANEL_HEADER_H + Math.max(listed.length, 1) * PANEL_ROW_H + (divided ? PANEL_DIVIDER_H : 0) + PANEL_SEARCH_H
}

/** What the panel's bottom line takes: a filter, an alias being typed, or a hotkey being recorded. */
export type PanelMode = { kind: 'filter' } | { kind: 'alias'; draft: string } | { kind: 'hotkey' }

interface ActionPanelProps {
  row: Row
  listed: ListedAction[]
  filter: string
  mode: PanelMode
  selected: number
  onSelect: (index: number) => void
  onRun: (listed: ListedAction) => void
}

/**
 * Every action of the selected row (⌘K), at the sheet's bottom right: the row's own, then the launcher's under a
 * divider (alias, hotkey, favourite, reset ranking), each with its icon and key. Typing filters it, in the search
 * line at its bottom; that line also takes an alias or records a hotkey.
 */
export function ActionPanel({ row, listed, filter, mode, selected, onSelect, onRun }: ActionPanelProps) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const firstOwn = listed.findIndex((a) => a.command)
  return (
    <div
      role="dialog"
      aria-label={`Actions for ${row.title}`}
      className="absolute flex flex-col bg-surface-2 text-foreground shadow-2xl ring-1 ring-white/10 ring-inset"
      style={{ right: SHEET_PAD, bottom: SHEET_PAD, width: PANEL_W, height: panelHeight(listed), padding: PANEL_PAD, borderRadius: PANEL_RADIUS }}
    >
      <p className="flex shrink-0 items-center truncate px-2.5 text-caption text-muted-foreground" style={{ height: PANEL_HEADER_H }}>
        <span className="truncate">{row.answer ? 'Actions' : row.title}</span>
      </p>
      <div ref={list} role="listbox" aria-label="Actions" className="min-h-0 flex-1">
        {listed.length === 0 && (
          <p className="flex items-center px-2.5 text-muted-foreground" style={{ height: PANEL_ROW_H }}>
            No actions match.
          </p>
        )}
        {listed.map((item, i) => {
          const active = i === selected
          const Icon = item.action.icon
          const key = item.command ? (item.action.shortcut && formatAccelerator(item.action.shortcut)) : actionKey(item.action, item.index)
          return (
            <div key={`${item.command ?? item.index}:${item.action.title}`}>
              {i === firstOwn && i > 0 && <div className="mx-2.5 border-t border-white/10" style={{ marginTop: 4, marginBottom: 4 }} />}
              <div
                role="option"
                aria-selected={active}
                data-selected={active || undefined}
                className="flex cursor-default items-center gap-2.5 px-2.5 aria-selected:bg-surface-3"
                style={{ height: PANEL_ROW_H, borderRadius: PANEL_ROW_RADIUS }}
                onPointerMove={() => !active && onSelect(i)}
                onClick={() => onRun(item)}
              >
                <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{Icon && <Icon className="size-4" />}</span>
                <span className="min-w-0 flex-1 truncate">{item.action.title}</span>
                {key && <span className="shrink-0 text-caption text-muted-foreground">{key}</span>}
              </div>
            </div>
          )
        })}
      </div>
      <SearchLine row={row} filter={filter} mode={mode} />
    </div>
  )
}

/** The panel's bottom line, with a caret: what's typed into the filter, the alias, or the hotkey prompt. */
function SearchLine({ row, filter, mode }: { row: Row; filter: string; mode: PanelMode }) {
  const caret = <span className="ml-px inline-block h-4 w-px animate-pulse bg-foreground align-middle" />
  let content
  if (mode.kind === 'alias')
    content = (
      <>
        <span className="shrink-0 text-muted-foreground">Alias</span>
        <span className="min-w-0 flex-1 truncate">
          {mode.draft}
          {caret}
        </span>
        <span className="shrink-0 text-caption text-muted-foreground">↩ Save</span>
      </>
    )
  else if (mode.kind === 'hotkey')
    content = (
      <>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Press a hotkey for {row.title}…</span>
        <span className="shrink-0 text-caption text-muted-foreground">⌫ Remove</span>
      </>
    )
  else
    content = filter ? (
      <span className="min-w-0 flex-1 truncate">
        {filter}
        {caret}
      </span>
    ) : (
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {caret}
        Search actions…
      </span>
    )
  return (
    <div className="mt-1 flex shrink-0 items-center gap-2 border-t border-white/10 px-2.5" style={{ height: PANEL_SEARCH_H - 4 }}>
      {content}
    </div>
  )
}
