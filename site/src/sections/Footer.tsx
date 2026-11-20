import { NotchWordmark } from '../brand/Mark'
import { CHANGELOG_URL, DEVELOPERS_URL, HOME, ISSUES_URL, LICENSE_URL, MODO_URL, REPO_URL } from '../data'

export function Footer() {
  return (
    <footer className="footer field-ink">
      <div className="footer-top">
        <p className="body footer-note" data-rv>
          Just Notch is fair source under FSL-1.1-MIT: free to build and use, and every release becomes MIT two
          years after it ships. It collects nothing about you.
        </p>
        <ul className="footer-links" data-rv style={{ '--i': 1 } as React.CSSProperties}>
          <li><a href={CHANGELOG_URL}>Changelog</a></li>
          <li><a href={`${HOME}#faq`}>Privacy</a></li>
          <li><a href={ISSUES_URL}>Support</a></li>
          <li><a href={DEVELOPERS_URL}>Build a plugin</a></li>
          <li><a href={REPO_URL}>GitHub</a></li>
          <li><a href={LICENSE_URL}>License</a></li>
          <li><a href={MODO_URL}>Built with modo</a></li>
        </ul>
      </div>
      <div className="footer-name" role="img" aria-label="Just Notch">
        <NotchWordmark className="footer-wordmark" />
      </div>
    </footer>
  )
}
