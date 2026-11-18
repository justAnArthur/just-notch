import { NotchWordmark } from '../brand/Mark'
import { LICENSE_URL, MODO_URL, RELEASES_URL, REPO_URL } from '../data'

export function Footer() {
  return (
    <footer className="footer field-ink">
      <div className="footer-top">
        <p className="body footer-note" data-rv>
          Just Notch is fair source under FSL-1.1-MIT: free to build and use, and every release becomes MIT two
          years after it ships.
        </p>
        <ul className="footer-links" data-rv style={{ '--i': 1 } as React.CSSProperties}>
          <li><a href={RELEASES_URL}>Releases</a></li>
          <li><a href={REPO_URL}>GitHub</a></li>
          <li><a href={LICENSE_URL}>Licence</a></li>
          <li><a href={MODO_URL}>Built with modo</a></li>
        </ul>
      </div>
      <p className="footer-name" aria-label="Just Notch">
        <NotchWordmark className="footer-wordmark" />
      </p>
    </footer>
  )
}
