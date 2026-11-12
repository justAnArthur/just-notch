import { type RefObject, useEffect } from 'react'

/**
 * Names the edges `ref` has more to scroll past in its `data-fade` (`start`, `end`), which `.edge-fade` masks.
 * Updated on scroll and resize only, so a scroller at rest costs nothing and one with nothing to scroll has no mask.
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>, axis: 'x' | 'y', content?: unknown) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const position = axis === 'x' ? el.scrollLeft : el.scrollTop
      const max = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight
      const edges = [position > 1 && 'start', position < max - 1 && 'end'].filter(Boolean).join(' ')
      if (el.dataset.fade !== edges) el.dataset.fade = edges
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [ref, axis, content])
}
