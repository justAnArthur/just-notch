import Button from '@justanarthur/modo-ui/components/actions/button'
import { ArrowDownToLine, Command, Eye } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { DOWNLOAD_URL } from '../data'
import { Nav } from './Nav'

// The live island is the heaviest thing on the page; it loads after the headline paints.
const HeroIsland = lazy(() => import('./HeroIsland'))

const placeholder = <div className="island-placeholder" aria-hidden="true" />

export function Hero() {
  // The prerendered page carries the closed notch; the island mounts once the page is hydrated.
  const [live, setLive] = useState(false)
  useEffect(() => setLive(true), [])
  return (
    <header className="hero field-screen" id="top">
      <Nav />

      <div className="island-stage">
        {live ? (
          <Suspense fallback={placeholder}>
            <HeroIsland />
          </Suspense>
        ) : (
          placeholder
        )}
      </div>
      <p className="island-hint">
        <span className="hint-pointer">Hover the island, or click it.</span>
        <span className="hint-touch">Tap the island.</span>
      </p>

      <div className="hero-foot">
        <div className="hero-copy">
          <h1 className="display">
            The Dynamic Island Apple only gives the new MacBook Pro, on the Mac you already have.
          </h1>
          <ul className="jobs">
            <li>
              <Eye className="jobs-icon" size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>
                <strong>Glance.</strong> What is playing, your next meeting and the weather sit beside the notch,
                one hover from the whole view.
              </span>
            </li>
            <li>
              <Command className="jobs-icon" size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>
                <strong>Act.</strong> Press ⌥Space and a launcher drops out of the notch: apps, files, answers,
                your clipboard, and windows moved to halves and thirds.
              </span>
            </li>
          </ul>
        </div>
        <div className="capsule" id="download">
          <span className="capsule-note">macOS 14 or later</span>
          <Button className="cta brand-action" leadingIcon={ArrowDownToLine} render={<a href={DOWNLOAD_URL} />}>
            Download for Mac
          </Button>
        </div>
      </div>
    </header>
  )
}
