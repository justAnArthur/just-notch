import { useReveal } from '../reveal'
import { Build } from '../sections/Build'
import { Footer } from '../sections/Footer'
import { Nav } from '../sections/Nav'

/** The developer page: building a plugin and publishing it to the library, apart from the buyer's page. */
export function Developers() {
  useReveal()
  return (
    <>
      <header className="field-ink">
        <Nav home={import.meta.env.BASE_URL} />
      </header>
      <main>
        <Build heading="h1" />
      </main>
      <Footer />
    </>
  )
}
