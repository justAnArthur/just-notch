import Button from '@justanarthur/modo-ui/components/actions/button'
import Badge from '@justanarthur/modo-ui/components/data-display/badge'
import { useEffect, useState } from 'react'
import type { LibraryCatalog, LibraryEntry } from '../../../packages/bridge-schema/src/index'
import { CATALOG_URL, LIBRARY_GUIDE_URL, permissionLabel } from '../data'

/** `undefined` while loading; an empty list when the catalog is missing or broken. */
function useCatalog() {
  const [plugins, setPlugins] = useState<LibraryEntry[]>()
  useEffect(() => {
    fetch(CATALOG_URL)
      .then((res) => (res.ok ? (res.json() as Promise<LibraryCatalog>) : undefined))
      .then((catalog) => setPlugins(catalog?.schema === 1 && Array.isArray(catalog.plugins) ? catalog.plugins : []))
      .catch(() => setPlugins([]))
  }, [])
  return plugins
}

function Entry({ plugin }: { plugin: LibraryEntry }) {
  return (
    <li className="library-entry">
      {plugin.icon ? (
        <img className="library-icon" src={plugin.icon} alt="" width={44} height={44} loading="lazy" decoding="async" />
      ) : (
        <span className="library-icon" aria-hidden="true" />
      )}
      <div className="library-main">
        <h3 className="library-name">
          {plugin.name} <span className="library-meta">{plugin.version}</span>
        </h3>
        {plugin.description && <p className="library-description">{plugin.description}</p>}
        <p className="library-chips" aria-label="What it may read and reach">
          {plugin.permissions.map((id) => (
            <Badge key={id} size="compact" variant="outline" title={id}>
              {permissionLabel(id)}
            </Badge>
          ))}
          {plugin.hosts.map((host) => (
            <Badge key={host} size="compact" title={`Reaches ${host}`}>
              {host}
            </Badge>
          ))}
        </p>
        <p className="library-meta">
          {plugin.author && <>By {plugin.author} · </>}
          <a className="inline-link" href={plugin.source}>Source</a>
        </p>
      </div>
      <Button
        className="library-open"
        size="compact"
        variant="secondary"
        render={<a href={`justnotch://library/${plugin.id}`} aria-label={`Open ${plugin.name} in Just Notch`} />}
      >
        Open in Just Notch
      </Button>
    </li>
  )
}

/** The optional plugins from the library catalog, the same file the app reads. */
export function Library() {
  const plugins = useCatalog()
  return (
    <section className="library field-ink" id="library" aria-labelledby="library-title">
      <div className="library-head">
        <h2 className="headline" id="library-title" data-rv>
          More in<br /> the library.
        </h2>
        <p className="body" data-rv style={{ '--i': 1 } as React.CSSProperties}>
          Optional plugins, one click from Settings › Library. Each is released on its own and checked against its
          published hash, and installs only after you approve what it may read and which hosts it may reach.
        </p>
        <a className="text-link" href={LIBRARY_GUIDE_URL} data-rv style={{ '--i': 2 } as React.CSSProperties}>
          Contribute a plugin
        </a>
      </div>
      {/* Rendered before the catalog arrives, so the entrance observer sees it. */}
      <div className="library-body" data-rv style={{ '--i': 2 } as React.CSSProperties} aria-busy={plugins === undefined}>
        {plugins?.length ? (
          <ul className="library-list">
            {plugins.map((p) => (
              <Entry key={p.id} plugin={p} />
            ))}
          </ul>
        ) : (
          plugins && <p className="library-soon">The first library plugins are on their way.</p>
        )}
      </div>
    </section>
  )
}
