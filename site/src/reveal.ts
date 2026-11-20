import { useEffect } from 'react'

/** Entrances: each [data-rv] rises into place once, the first time it comes into view. */
export function useReveal() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('rv-ready')
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('in')
          seen.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    for (const el of document.querySelectorAll('[data-rv]')) seen.observe(el)
    return () => seen.disconnect()
  }, [])
}
