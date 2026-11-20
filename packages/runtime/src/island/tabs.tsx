import type { IconProps } from '@just-notch/sdk'
import { cn, FluidHoverHighlight, useFluidHover, useRegisterFluidHoverItem } from '@justanarthur/modo-ui'
import { type ComponentType, type CSSProperties, useEffect, useRef } from 'react'
import { useEdgeFade } from './edge-fade'
import { type StripLayout, TAB_ICON } from './geometry'
import { motionScale } from './motion'

export interface Tab {
  id: string
  plugin: string
  label: string
  icon: ComponentType<IconProps>
  view: ComponentType
}

interface TabButtonProps {
  tab: Tab
  index: number
  selected: boolean
  lit: boolean
  register: (index: number, element: HTMLElement | null) => void
  onSelect: (index: number) => void
}

function TabButton({ tab, index, selected, lit, register, onSelect }: TabButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)
  useRegisterFluidHoverItem(register, index, ref)
  const Icon = tab.icon
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={tab.label}
      tabIndex={selected ? 0 : -1}
      data-fluid-hover-index={index}
      className={cn(
        'relative z-10 flex h-7 w-7.5 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none transition-[color] duration-fast focus-visible:ring-1 focus-visible:ring-focus-ring',
        lit ? 'text-foreground' : 'text-muted-foreground',
      )}
      onClick={() => onSelect(index)}
    >
      <Icon size={TAB_ICON.size} strokeWidth={lit ? TAB_ICON.lit : TAB_ICON.stroke} className="transition-[stroke-width] duration-fast" />
    </button>
  )
}

interface TabStripProps {
  tabs: Tab[]
  selected: number
  layout: StripLayout
  onSelect: (index: number) => void
}

/**
 * Icon tabs across both wings: the left wing's tabs, a gap the width of the notch, the right wing's.
 * The selected pill melts from tab to tab (across the notch too); past what both wings hold the strip scrolls behind the notch.
 */
export default function TabStrip({ tabs, selected, layout, onSelect }: TabStripProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const hover = useFluidHover(viewport, { axis: 'x' })
  useEdgeFade(viewport, 'x', layout.overflow)

  // Scrolls only the strip (scrollIntoView would scroll the page under the island too), and moves keyboard focus along.
  useEffect(() => {
    const el = viewport.current
    const active = el?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')
    if (!el || !active) return
    if (el.contains(document.activeElement) && document.activeElement !== active) active.focus({ preventScroll: true })
    const left = active.offsetLeft - el.scrollLeft
    const right = left + active.offsetWidth - el.clientWidth
    if (left < 0) el.scrollBy({ left: left - 16 })
    else if (right > 0) el.scrollBy({ left: right + 16 })
  }, [selected])

  const rect = hover.isMeasured ? hover.itemRects[selected] : undefined
  const holes = { '--hole-start': `${layout.hole.start}px`, '--hole-end': `${layout.hole.end}px` } as CSSProperties
  const button = (tab: Tab, index: number) => (
    <TabButton
      key={tab.id}
      tab={tab}
      index={index}
      selected={index === selected}
      lit={index === selected || index === hover.activeIndex}
      register={hover.registerItem}
      onSelect={onSelect}
    />
  )

  return (
    <div
      ref={viewport}
      role="tablist"
      aria-label="Widgets"
      data-tab-strip
      className="edge-fade edge-fade-notch relative h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-hide"
      style={holes}
      onMouseMove={hover.handlers.onMouseMove}
      onMouseEnter={hover.handlers.onMouseEnter}
      onMouseLeave={hover.handlers.onMouseLeave}
    >
      <div className="flex h-full w-max min-w-full items-center">
        {rect && <FluidHoverHighlight rect={rect} session={0} className="rounded-lg bg-active" transition={motionScale.micro} />}
        <FluidHoverHighlight hover={hover} hidden={hover.activeIndex === selected} className="rounded-lg" />
        {tabs.slice(0, layout.before).map(button)}
        <div aria-hidden className="h-full shrink-0 grow" style={{ minWidth: layout.spacer }} />
        {tabs.slice(layout.before).map((tab, i) => button(tab, layout.before + i))}
      </div>
    </div>
  )
}
