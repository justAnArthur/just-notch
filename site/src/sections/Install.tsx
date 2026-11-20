import Button from '@justanarthur/modo-ui/components/actions/button'
import { ArrowDownToLine } from 'lucide-react'
import { DOWNLOAD_URL } from '../data'

/** System Settings › Privacy & Security, drawn: the row macOS 15 and 26 add after a blocked first open. */
function OpenAnyway() {
  return (
    <figure className="gatekeeper" aria-label="System Settings, Privacy & Security: “Just Notch” was blocked to protect your Mac, with an Open Anyway button.">
      <div className="gatekeeper-window" aria-hidden="true">
        <p className="gatekeeper-path">Privacy & Security</p>
        <p className="gatekeeper-group">Security</p>
        <div className="gatekeeper-row">
          <span>“Just Notch” was blocked to protect your Mac.</span>
          <span className="gatekeeper-button">Open Anyway</span>
        </div>
      </div>
      <figcaption>System Settings › Privacy & Security, under Security.</figcaption>
    </figure>
  )
}

export function Install() {
  return (
    <section className="install field-light light" id="install" aria-labelledby="install-title">
      <h2 className="headline" id="install-title" data-rv>
        Install in<br /> four steps.
      </h2>

      <ol className="steps">
        <li data-rv style={{ '--i': 1 } as React.CSSProperties}>
          <p className="step-text">Download Just Notch from the latest release.</p>
          <Button className="cta brand-action" leadingIcon={ArrowDownToLine} render={<a href={DOWNLOAD_URL} />}>
            Download for Mac
          </Button>
        </li>
        <li data-rv style={{ '--i': 2 } as React.CSSProperties}>
          <p className="step-text">Unzip it and drag Just Notch into Applications.</p>
        </li>
        <li data-rv style={{ '--i': 3 } as React.CSSProperties}>
          <p className="step-text">Open it once. macOS says it can’t check it: choose Done.</p>
          <p className="body">
            Apple only vouches for notarized apps, and this build isn’t notarized yet. Nothing is wrong with your
            download.
          </p>
        </li>
        <li data-rv style={{ '--i': 4 } as React.CSSProperties}>
          <p className="step-text">In Privacy & Security, choose Open Anyway.</p>
          <p className="body">
            Open System Settings › Privacy & Security, scroll to Security and choose Open Anyway beside Just
            Notch, then confirm with your password or Touch ID. You do this once; after that it opens like any
            app. On macOS 14 Sonoma, Control-click the app and choose Open instead.
          </p>
          <OpenAnyway />
        </li>
      </ol>
    </section>
  )
}
