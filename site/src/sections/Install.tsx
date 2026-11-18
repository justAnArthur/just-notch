import Accordion from '@justanarthur/modo-ui/components/containers/accordion'
import Button from '@justanarthur/modo-ui/components/actions/button'
import Copy from '@justanarthur/modo-ui/components/actions/copy'
import { ArrowDownToLine } from 'lucide-react'
import { DOWNLOAD_URL, LICENSE_URL, QUARANTINE_COMMAND } from '../data'

export function Install() {
  return (
    <section className="install field-light light" id="install" aria-labelledby="install-title">
      <h2 className="headline" id="install-title" data-rv>
        Install in<br /> three steps.
      </h2>

      <ol className="steps">
        <li data-rv style={{ '--i': 1 } as React.CSSProperties}>
          <p className="step-text">Download JustNotch.zip from the latest release on GitHub.</p>
          <Button className="cta brand-action" leadingIcon={ArrowDownToLine} render={<a href={DOWNLOAD_URL} />}>
            Download for Mac
          </Button>
        </li>
        <li data-rv style={{ '--i': 2 } as React.CSSProperties}>
          <p className="step-text">Unzip it and drag Just Notch into Applications.</p>
        </li>
        <li data-rv style={{ '--i': 3 } as React.CSSProperties}>
          <p className="step-text">The first time, right-click the app and choose Open.</p>
          <p className="body">
            The build is signed ad hoc and not notarized, so macOS asks once. If it refuses to open, clear the
            quarantine flag in Terminal instead:
          </p>
          <Copy className="step-copy" value={QUARANTINE_COMMAND} label="Terminal" />
        </li>
      </ol>

      <div className="install-faq" data-rv style={{ '--i': 4 } as React.CSSProperties}>
        <Accordion.Group type="single" className="faq">
          <Accordion.Item value="warning">
            <Accordion.Trigger>Why does macOS warn me?</Accordion.Trigger>
            <Accordion.Content>
              Apple only skips the warning for notarized apps. This build is signed on the machine that made
              it, so Gatekeeper cannot vouch for it. The source it was built from is on GitHub for you to read
              or build yourself.
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="needs">
            <Accordion.Trigger>What does it need?</Accordion.Trigger>
            <Accordion.Content>
              macOS 14 Sonoma or later. It is made for a MacBook with a notch; on other screens it can draw a
              virtual notch. Each plugin asks only for the permissions in its manifest, such as your calendars
              for Calendar.
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="fair">
            <Accordion.Trigger>What does fair source mean?</Accordion.Trigger>
            <Accordion.Content>
              The code is public under the{' '}
              <a href={LICENSE_URL} className="inline-link">
                Functional Source License (FSL-1.1-MIT)
              </a>
              . You may read it, build it and use it for free. Nobody may sell a competing product made from it,
              and every release becomes MIT two years after it ships.
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Group>
      </div>
    </section>
  )
}
