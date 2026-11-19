import { useEffect, useRef } from 'react'
import { useIcons } from './apps'
import type { Row, RowIcon, Section } from './rows'

export const ROW_H = 40
/** The inline answer card: the result large, the expression and its source under it. */
export const ANSWER_H = 68
export const HEADER_H = 26
export const SHEET_PAD = 6
/** The sheet's corner radius; a row's is that less the padding, so the two curves stay concentric. */
export const SHEET_RADIUS = 26
const ROW_RADIUS = SHEET_RADIUS - SHEET_PAD

/** The sheet's height for these sections, before it scrolls. */
export const sectionsHeight = (sections: Section[]) =>
  SHEET_PAD * 2 + sections.reduce((h, s) => h + HEADER_H + s.rows.reduce((r, row) => r + (row.answer ? ANSWER_H : ROW_H), 0), 0)

interface ResultsProps {
  sections: Section[]
  selected: number
  onSelect: (index: number) => void
  onRun: (index: number) => void
}

/** Grouped rows under the bar; the selected one shows its main action. Indexes run across sections. */
export function Results({ sections, selected, onSelect, onRun }: ResultsProps) {
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
          <p className="flex items-end px-3 pb-1 text-caption text-muted-foreground" style={{ height: HEADER_H }}>
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
                className="flex cursor-default items-center gap-3 px-3 aria-selected:bg-surface-3"
                style={{ height: row.answer ? ANSWER_H : ROW_H, borderRadius: ROW_RADIUS }}
                onPointerMove={() => !active && onSelect(i)}
                onClick={() => onRun(i)}
              >
                {row.answer ? <Answer row={row} /> : <Plain row={row} icon={row.icon} icons={icons} />}
                <span className="shrink-0 text-caption text-muted-foreground">
                  {active ? (
                    <>
                      {row.actions[0]?.title} ↩
                      {row.actions.length > 1 && <span className="ml-2 rounded-md bg-surface-4 px-1.5 py-0.5">⌘K</span>}
                    </>
                  ) : (
                    row.accessory
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

function Plain({ row, icon, icons }: { row: Row; icon?: RowIcon; icons: Map<string, string> }) {
  return (
    <>
      <Icon icon={icon} icons={icons} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate">{row.title}</span>
        {row.subtitle && <span className="truncate text-caption text-muted-foreground">{row.subtitle}</span>}
      </span>
    </>
  )
}

function Answer({ row }: { row: Row }) {
  const answer = row.answer!
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[24px] leading-tight">{answer.result}</span>
      <span className="truncate text-caption text-muted-foreground">
        {answer.expression}
        {answer.detail && ` · ${answer.detail}`}
      </span>
    </span>
  )
}

function Icon({ icon, icons }: { icon?: RowIcon; icons: Map<string, string> }) {
  const src = icon && ('src' in icon ? icon.src : 'path' in icon ? icons.get(icon.path) : undefined)
  if (src) return <img src={src} alt="" className="size-7 shrink-0 rounded-md object-contain" draggable={false} />
  const Glyph = icon && 'glyph' in icon ? icon.glyph : undefined
  return <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">{Glyph && <Glyph className="size-5" />}</span>
}

/** One line in place of results: nothing found, or a scope waiting for a query. */
export function Note({ children }: { children: string }) {
  return <p className="px-5 py-4 text-muted-foreground">{children}</p>
}
