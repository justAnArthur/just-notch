import Kbd from '@justanarthur/modo-ui/components/data-display/kbd'
import { LAUNCHER_FINDS, LAUNCHER_KEYS } from '../data'

/** The launcher: what it finds and the keys that drive it. */
export function Launcher() {
  return (
    <section className="ledger launcher field-screen" id="launcher" aria-labelledby="launcher-title">
      <div className="ledger-head">
        <h2 className="headline" id="launcher-title" data-rv>
          Search drops<br /> out of the notch.
        </h2>
        <p className="body" data-rv style={{ '--i': 1 } as React.CSSProperties}>
          Press ⌥Space and a drop falls from the notch, then spreads into a search bar in the middle of the
          screen, where Spotlight's sits. Pick another shortcut in Settings › Launcher, or take ⌘Space once
          Spotlight lets it go.
        </p>
        <p className="body" data-rv style={{ '--i': 2 } as React.CSSProperties}>
          The round buttons beside the bar are scopes. Type a keyword and a space to enter one: app, file,
          action, clip. Plugins can add their own.
        </p>
      </div>
      <div className="launcher-body" data-rv style={{ '--i': 2 } as React.CSSProperties}>
        <table className="ledger-table launcher-table">
          <thead>
            <tr>
              <th scope="col">Finds</th>
              <th scope="col">What comes up</th>
            </tr>
          </thead>
          <tbody>
            {LAUNCHER_FINDS.map((f) => (
              <tr key={f.name}>
                <th scope="row">{f.name}</th>
                <td>{f.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="launcher-keys" aria-label="Keys">
          {LAUNCHER_KEYS.map((k) => (
            <div key={k.keys}>
              <dt>
                <Kbd>{k.keys}</Kbd>
              </dt>
              <dd>{k.does}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
