import { Faq } from './sections/Faq'
import { Footer } from './sections/Footer'
import { Hero } from './sections/Hero'
import { Install } from './sections/Install'
import { Launcher } from './sections/Launcher'
import { Library } from './sections/Library'
import { Plugins } from './sections/Plugins'
import { Pricing } from './sections/Pricing'
import { Tall } from './sections/Tall'
import { useReveal } from './reveal'

export function App() {
  useReveal()
  return (
    <>
      <Hero />
      <main>
        <Plugins />
        <Tall />
        <Library />
        <Launcher />
        <Pricing />
        <Install />
        <Faq />
      </main>
      <Footer />
    </>
  )
}
