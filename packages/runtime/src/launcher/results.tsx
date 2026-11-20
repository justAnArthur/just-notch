import { useEffect, useRef } from 'react'
import { useIcons } from './apps'
import type { Row, RowIcon, Section } from './rows'

export const ROW_H = 40
/** The inline answer card: the expression on the left, the result large on the right. */
export const ANSWER_H = 72
export const HEADER_H = 24
export const SHEET_PAD = 6
/** The sheet's corners: a macOS sheet's, not a pill's. */
export const SHEET_RADIUS = 14
/** A row's corners, the same at every height: an 8 pt rounded rectangle when selected. */
export const ROW_RADIUS = 8

/** One key style for every hint: `Open ↩`, `Actions ⌘K`, `⌘3`, the scope's `⌘2`. */
export function Kbd({ children }: { children: string }) {
  return <kbd className="rounded-md bg-white/10 px-1.5 py-0.5 font-sans text-[11px] leading-none text-muted-foreground">{children}</kbd>
}

/** `Application` under Applications, `Window Management` under Window Management: said once, by the header. */
const repeats = (text: string | undefined, section: string) => !!text && (section.startsWith(text) || text === section)

/** The sheet's height for these sections, before it scrolls. */
export const sectionsHeight = (sections: Section[]) =>
  SHEET_PAD * 2 + sections.reduce((h, s) => h + HEADER_H + s.rows.reduce((r, row) => r + (row.answer ? ANSWER_H : ROW_H), 0), 0)

interface ResultsProps {
  sections: Section[]
  selected: number
  onSelect: (index: number) => void
  onRun: (index: number) => void
  /** Beside the preview pane, which shows the subtitle: titles get the room. */
  compact?: boolean
  /** ⌘1–⌘9 run the first nine rows (a scope that takes number keys): each shows its key. */
  numbered?: boolean
  /** A row waiting for a second ↩, and what it says meanwhile. */
  confirming?: { id: string; text: string }
}

/** Grouped rows under the bar; the selected one shows its main action. Indexes run across sections. */
export function Results({ sections, selected, onSelect, onRun, compact, numbered, confirming }: ResultsProps) {
  const paths = sections.flatMap((s) => s.rows.flatMap((r) => (r.icon && 'path' in r.icon ? [r.icon.path] : [])))
  const icons = useIcons(paths)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  let index = 0
  return (
    <div ref={list} role="listbox" aria-label="Results" className="h-full overflow-y-auto" style={{ padding: SHEET_PAD }}>
      {sections.map((section) => (
        <div key={section.title} role="group" aria-label={section.title}>
          <p className="flex items-end px-3 pb-1 text-[11px] font-semibold text-muted-foreground" style={{ height: HEADER_H }}>
            {section.title}
          </p>
          {section.rows.map((row) => {
            const i = index++
            const active = i === selected
            return (
              <div
                key={row.id}
                role="option"
                aria-selected={active}
                data-selected={active || undefined}
                className={`flex cursor-default items-center gap-3 px-3 aria-selected:bg-surface-3 ${row.failed ? 'text-muted-foreground' : ''}`}
                style={{ height: row.answer ? ANSWER_H : ROW_H, borderRadius: ROW_RADIUS }}
                onPointerMove={() => !active && onSelect(i)}
                onClick={() => onRun(i)}
              >
                {row.answer ? (
                  <Answer row={row} />
                ) : (
                  <Plain
                    row={confirming?.id === row.id ? { ...row, title: confirming.text, subtitle: undefined } : { ...row, subtitle: repeats(row.subtitle, section.title) ? undefined : row.subtitle }}
                    icon={row.icon}
                    icons={icons}
                    compact={compact}
                    warn={confirming?.id === row.id}
                  />
                )}
                <span className="flex shrink-0 items-center gap-2 text-caption text-muted-foreground">
                  {active ? (
                    <>
                      {row.actions[0] && (
                        <>
                          {row.actions[0].title} <Kbd>↩</Kbd>
                        </>
                      )}
                      {!row.failed && (
                        <>
                          <span className="ml-1">Actions</span> <Kbd>⌘K</Kbd>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {!row.answer && !repeats(row.accessory, section.title) && row.accessory}
                      {numbered && i < 9 && <Kbd>{`⌘${i + 1}`}</Kbd>}
                    </>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Plain({ row, icon, icons, compact, warn }: { row: Row; icon?: RowIcon; icons: Map<string, string>; compact?: boolean; warn?: boolean }) {
  return (
    <>
      <Icon icon={icon} icons={icons} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className={`truncate ${warn ? 'text-status-warning' : ''}`}>{row.title}</span>
        {row.subtitle && !compact && <span className="truncate text-caption text-muted-foreground">{row.subtitle}</span>}
      </span>
    </>
  )
}

/** The inline answer in two columns, as a calculator tape reads: what was asked, then the answer, large. */
function Answer({ row }: { row: Row }) {
  const answer = row.answer!
  return (
    <span className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-3">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[17px] text-muted-foreground">{answer.expression}</span>
        {answer.detail && <span className="truncate text-caption text-muted-foreground/70">{answer.detail}</span>}
      </span>
      <span className="text-muted-foreground">→</span>
      <span className="truncate text-right text-[28px] font-semibold leading-tight tabular-nums">{answer.result}</span>
    </span>
  )
}

/**
 * A row's icon, all on one grammar: an app's or file's own icon or an image as it is, and every glyph (actions,
 * Shortcuts, the web, plugin rows) on a 28 pt rounded tile, so built-in and plugin rows look alike.
 */
export function Icon({ icon, icons, large }: { icon?: RowIcon; icons: Map<string, string>; large?: boolean }) {
  const box = large ? 'size-20' : 'size-7'
  const src = icon && ('src' in icon ? icon.src : 'path' in icon ? icons.get(icon.path) : undefined)
  if (src) return <img src={src} alt="" className={`${box} shrink-0 rounded-md object-contain`} draggable={false} />
  const Glyph = icon && 'glyph' in icon ? icon.glyph : undefined
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center bg-surface-3 text-foreground/80 ${large ? 'rounded-2xl' : 'rounded-lg'}`}>
      {Glyph && <Glyph className={large ? 'size-10' : 'size-4'} />}
    </span>
  )
}

/** One line in place of results: nothing found, or a scope waiting for a query. */
export function Note({ children }: { children: string }) {
  return <p className="px-5 py-4 text-muted-foreground">{children}</p>
}
