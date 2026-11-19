import { AppWindow, type LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { AppResult } from './apps'
import { useIcons } from './apps'

export const ROW_H = 40
export const HEADER_H = 26
export const SHEET_PAD = 6
/** The sheet's corner radius; a row's is that less the padding, so the two curves stay concentric. */
export const SHEET_RADIUS = 26
const ROW_RADIUS = SHEET_RADIUS - SHEET_PAD

export interface Section {
  title: string
  results: AppResult[]
}

/** The sheet's height for these sections, before it scrolls. */
export const sectionsHeight = (sections: Section[]) =>
  SHEET_PAD * 2 + sections.reduce((h, s) => h + HEADER_H + s.results.length * ROW_H, 0)

interface ResultsProps {
  sections: Section[]
  selected: number
  onSelect: (index: number) => void
  onRun: (index: number) => void
}

/** Grouped rows under the pill; the selected one shows its action. Indexes run across sections. */
export function Results({ sections, selected, onSelect, onRun }: ResultsProps) {
  const icons = useIcons(sections.flatMap((s) => s.results.map((r) => r.app.path)))
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
          {section.results.map((result) => {
            const i = index++
            const active = i === selected
            const icon = icons.get(result.app.path)
            return (
              <div
                key={result.id}
                role="option"
                aria-selected={active}
                data-selected={active || undefined}
                className="flex cursor-default items-center gap-3 px-3 aria-selected:bg-surface-3"
                style={{ height: ROW_H, borderRadius: ROW_RADIUS }}
                onPointerMove={() => !active && onSelect(i)}
                onClick={() => onRun(i)}
              >
                {icon ? <img src={icon} alt="" className="size-7 shrink-0" draggable={false} /> : <Glyph icon={AppWindow} />}
                <span className="min-w-0 flex-1 truncate">{result.app.name}</span>
                <span className="shrink-0 text-caption text-muted-foreground">{active ? 'Open ↩' : 'Application'}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Glyph({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
      <Icon className="size-5" />
    </span>
  )
}

/** One line in place of results: nothing found, or a scope that isn't built yet. */
export function Note({ children }: { children: string }) {
  return <p className="px-5 py-4 text-muted-foreground">{children}</p>
}
