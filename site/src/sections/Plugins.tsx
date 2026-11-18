import Badge from '@justanarthur/modo-ui/components/data-display/badge'
import { PLUGINS, permissionLabel, SETTINGS } from '../data'

/** The seven plugins as their manifests state them: name, what it does, what it may read. */
export function Plugins() {
  return (
    <section className="ledger field-ink" id="plugins" aria-labelledby="plugins-title">
      <div className="ledger-head">
        <h2 className="headline" id="plugins-title" data-rv>
          Seven plugins<br /> in the box.
        </h2>
        <p className="body" data-rv style={{ '--i': 1 } as React.CSSProperties}>
          Each one is a tab in the island and a manifest that says what it may read. Turn any of them off in
          Settings; the island keeps only what you use.
        </p>
        <figure className="ledger-figure" data-rv style={{ '--i': 2 } as React.CSSProperties}>
          <img src={SETTINGS.src} alt={SETTINGS.alt} width={720} height={569} loading="lazy" decoding="async" />
          <figcaption>Settings opens in the island too, with a page for every plugin.</figcaption>
        </figure>
      </div>
      <table className="ledger-table" data-rv style={{ '--i': 2 } as React.CSSProperties}>
        <thead>
          <tr>
            <th scope="col">Plugin</th>
            <th scope="col">What it shows</th>
            <th scope="col">What it may read</th>
          </tr>
        </thead>
        <tbody>
          {PLUGINS.map((p) => (
            <tr key={p.id}>
              <th scope="row">{p.name}</th>
              <td>{p.description}</td>
              <td>
                {p.permissions.length ? (
                  <span className="ledger-perms">
                    {p.permissions.map((id) => (
                      <Badge key={id} size="compact" variant="outline" title={id}>
                        {permissionLabel(id)}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  <span className="ledger-none">Nothing</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
