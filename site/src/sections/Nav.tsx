import Button from '@justanarthur/modo-ui/components/actions/button'
import { Wordmark } from '../brand/Mark'
import { DOWNLOAD_URL, HOME } from '../data'

/** The page's menu bar, as a Mac's: the name, three places on the home page and Download. On other pages the links lead home. */
export function Nav({ home = '' }: { home?: string }) {
  return (
    <nav className="menubar" aria-label="Main">
      <div className="menubar-side">
        <a href={home || '#top'} className="menubar-home" aria-label="Just Notch, home">
          <Wordmark />
        </a>
      </div>
      {/* Right of the notch, as a Mac's status items: the island opens from the middle and leaves both sides free. */}
      <div className="menubar-side menubar-end">
        <a className="menubar-link" href={`${home}#features`}>Features</a>
        <a className="menubar-link" href={`${home}#launcher`}>Launcher</a>
        <a className="menubar-link" href={`${home}#pricing`}>Pricing</a>
        <Button size="compact" variant="secondary" render={<a href={home ? `${HOME}#download` : DOWNLOAD_URL} />}>
          Download
        </Button>
      </div>
    </nav>
  )
}
