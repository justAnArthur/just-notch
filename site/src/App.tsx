import { useEffect } from 'react'
import { Build } from './sections/Build'
import { Footer } from './sections/Footer'
import { Hero } from './sections/Hero'
import { Install } from './sections/Install'
import { Plugins } from './sections/Plugins'
import { Tall } from './sections/Tall'

/** Entrances: each [data-rv] rises into place once, the first time it comes into view. */
function useReveal() {
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

export function App() {
  useReveal()
  return (
    <>
      <Hero />
      <main>
        <Plugins />
        <Tall />
        <Install />
        <Build />
      </main>
      <Footer />
    </>
  )
}
