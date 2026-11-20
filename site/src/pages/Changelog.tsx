import Badge from '@justanarthur/modo-ui/components/data-display/badge'
import type { ChangelogEntry } from '../../scripts/changelog'
import { RELEASES_URL } from '../data'
import { useReveal } from '../reveal'
import { Footer } from '../sections/Footer'
import { Nav } from '../sections/Nav'

const KIND = { new: 'New', fixed: 'Fixed', faster: 'Faster' } as const

// Written by scripts/changelog.ts before the build (pages.yml) and bundled, so the page is prerendered whole.
// A local checkout without it gets the GitHub link instead.
const DATA = import.meta.glob<ChangelogEntry[]>('../../public/changelog.json', { eager: true, import: 'default' })
const ENTRIES = Object.values(DATA)[0] ?? []

const day = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' })

function Release({ entry }: { entry: ChangelogEntry }) {
  return (
    <article className="release" id={`v${entry.version}`}>
      <header className="release-head">
        <h2 className="release-version">
          <a href={entry.url}>{entry.version}</a>
        </h2>
        <time className="release-date" dateTime={entry.date}>
          {day(entry.date)}
        </time>
      </header>
      <div className="release-groups">
        {entry.groups.map((group) => (
          <section key={group.area} className="release-group">
            <h3 className="release-area">{group.area}</h3>
            <ul className="release-list">
              {group.changes.map((change) => (
                <li key={change.text}>
                  <Badge size="compact" variant="outline">
                    {KIND[change.kind]}
                  </Badge>
                  <span>{change.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  )
}

export function Changelog() {
  useReveal()
  return (
    <>
      <header className="page-head field-screen">
        <Nav home={import.meta.env.BASE_URL} />
        <div className="page-intro">
          <h1 className="headline">
            Changelog
          </h1>
          <p className="body">
            What changed in each version of Just Notch, newest first. The app updates itself; the full notes are
            on <a className="inline-link" href={RELEASES_URL}>GitHub</a>.
          </p>
        </div>
      </header>
      <main className="changelog field-ink">
        {ENTRIES.map((entry) => (
          <Release key={entry.version} entry={entry} />
        ))}
        {ENTRIES.length === 0 && (
          <p className="body">
            The changelog is written when the site is published. Until then, every release is on{' '}
            <a className="inline-link" href={RELEASES_URL}>
              GitHub
            </a>
            .
          </p>
        )}
      </main>
      <Footer />
    </>
  )
}
