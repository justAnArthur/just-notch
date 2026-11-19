import Button from '@justanarthur/modo-ui/components/actions/button'
import Tabs from '@justanarthur/modo-ui/components/navigation/tabs'
import { Activity, ArrowDownToLine, CalendarDays, ClipboardList, Clock3, CloudSun, FolderDown, Music } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Wordmark } from '../brand/Mark'
import { DOWNLOAD_URL, PLUGINS, REPO_URL } from '../data'

const ICON = {
  'now-playing': Music,
  calendar: CalendarDays,
  clipboard: ClipboardList,
  clock: Clock3,
  'recent-files': FolderDown,
  system: Activity,
  weather: CloudSun,
} as const

function useNarrow() {
  const query = '(max-width: 640px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setNarrow(list.matches)
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [])
  return narrow
}

export function Hero() {
  const [active, setActive] = useState('now-playing')
  const [open, setOpen] = useState(false)
  // On a phone the strip shows icons, with only the chosen plugin named, as the island's own tab row does.
  const narrow = useNarrow()

  // The island grows out of the notch once the page is up, as it does on hover.
  useEffect(() => {
    const timer = setTimeout(() => setOpen(true), 450)
    return () => clearTimeout(timer)
  }, [])

  return (
    <header className="hero field-screen" id="top">
      <nav className="menubar" aria-label="Main">
        <div className="menubar-side">
          <a href="#top" className="menubar-home" aria-label="Just Notch, top of the page">
            <Wordmark />
          </a>
          <a className="menubar-link" href="#plugins">Plugins</a>
          <a className="menubar-link" href="#library">Library</a>
          <a className="menubar-link" href="#launcher">Launcher</a>
          <a className="menubar-link" href="#install">Install</a>
        </div>
        <div className="menubar-side menubar-end">
          <a className="menubar-link" href="#build">Build a plugin</a>
          <a className="menubar-link" href={REPO_URL}>GitHub</a>
          <Button size="compact" variant="secondary" render={<a href={DOWNLOAD_URL} />}>
            Download
          </Button>
        </div>
      </nav>

      <div className="island-stage">
        <div
          className={`island${open ? ' is-open' : ''}`}
          role="img"
          aria-label={`The open island showing the ${PLUGINS.find((p) => p.id === active)?.name} plugin`}
        >
          {PLUGINS.map((p) => (
            <img
              key={p.id}
              src={p.shot}
              width={p.width / 2}
              height={p.height / 2}
              alt=""
              className={p.id === active ? 'on' : undefined}
              decoding="async"
              fetchPriority={p.id === 'now-playing' ? 'high' : 'low'}
            />
          ))}
        </div>
      </div>

      <div className="hero-switch" data-rv style={{ '--i': 2 } as React.CSSProperties}>
        <Tabs value={active} onValueChange={(v) => { setActive(v); setOpen(true) }} variant="subtle" size="compact" activeLabel={narrow}>
          <Tabs.List aria-label="Show a plugin in the island">
            {PLUGINS.map((p) => (
              <Tabs.Item key={p.id} value={p.id} icon={ICON[p.id as keyof typeof ICON]} label={p.name} />
            ))}
          </Tabs.List>
        </Tabs>
      </div>

      <div className="hero-foot">
        <div className="hero-copy">
          <h1 className="display" data-rv>
            Your notch,<br /> put to work.
          </h1>
          <p className="lede" data-rv style={{ '--i': 1 } as React.CSSProperties}>
            Just Notch turns the MacBook notch into a Dynamic Island: what is playing, your next meeting, the
            weather and four more plugins, one hover away. Press ⌥Space and search drops out of it.
          </p>
        </div>
        <div className="capsule" data-rv style={{ '--i': 2 } as React.CSSProperties}>
          <span className="capsule-note">Free · macOS 14 or later</span>
          <Button className="cta brand-action" leadingIcon={ArrowDownToLine} render={<a href={DOWNLOAD_URL} />}>
            Download for Mac
          </Button>
        </div>
      </div>
    </header>
  )
}
