import Accordion from '@justanarthur/modo-ui/components/containers/accordion'
import { CHANGELOG_URL, ISSUES_URL, LICENSE_URL } from '../data'

/** The questions a buyer asks before downloading, answered short and plainly. */
export function Faq() {
  return (
    <section className="faq-section field-screen" id="faq" aria-labelledby="faq-title">
      <h2 className="headline" id="faq-title" data-rv>
        Questions,<br /> answered.
      </h2>
      <div className="faq-body" data-rv style={{ '--i': 1 } as React.CSSProperties}>
        <Accordion.Group type="single" className="faq">
          <Accordion.Item value="privacy">
            <Accordion.Trigger>What does it collect?</Accordion.Trigger>
            <Accordion.Content>
              Nothing about you. There is no account, no analytics and no tracking. What it shows stays on your
              Mac: your calendars, clipboard and files are read where they are and never sent anywhere. It goes
              online only to fetch what you asked for: the forecast for your area, currency rates for the
              launcher, and new versions from GitHub. Tokens for plugins such as GitHub are kept in your Mac’s
              Keychain.
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="refunds">
            <Accordion.Trigger>Can I get a refund?</Accordion.Trigger>
            <Accordion.Content>
              Today there is nothing to refund: every build is free. When Pro goes on sale, its refund window
              will be stated here and at checkout, before you pay.
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="needs">
            <Accordion.Trigger>Which Macs does it run on?</Accordion.Trigger>
            <Accordion.Content>
              macOS 14 Sonoma or later. It is made for a MacBook with a notch; on other screens it draws a virtual
              notch at the top. Each plugin asks only for what it needs, such as your calendars for Calendar, and
              you can see and change every permission in Settings.
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="warning">
            <Accordion.Trigger>Why does macOS warn me the first time?</Accordion.Trigger>
            <Accordion.Content>
              Apple only skips the warning for notarized apps, and this build isn’t notarized yet. Open Anyway in
              Privacy & Security lets it through once. The source it is built from is public, for you to read or
              build yourself.
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="updates">
            <Accordion.Trigger>How does it update?</Accordion.Trigger>
            <Accordion.Content>
              It checks for new versions on its own and installs them with Sparkle, the updater most Mac apps use; Settings lets it download them in the background too. Every release is listed in the{' '}
              <a href={CHANGELOG_URL} className="inline-link">changelog</a>.
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="uninstall">
            <Accordion.Trigger>How do I remove it?</Accordion.Trigger>
            <Accordion.Content>
              Quit it from its menu bar item and move Just Notch from Applications to the Trash. Its settings and
              plugins live in ~/Library/Application Support/JustNotch; delete that folder too to leave nothing
              behind.
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="source">
            <Accordion.Trigger>Is it open source?</Accordion.Trigger>
            <Accordion.Content>
              It is fair source: the code is public under the{' '}
              <a href={LICENSE_URL} className="inline-link">Functional Source License (FSL-1.1-MIT)</a>. You may
              read it, build it and use it. Nobody may sell a competing product made from it, and every release
              becomes MIT two years after it ships.
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="help">
            <Accordion.Trigger>Where do I get help?</Accordion.Trigger>
            <Accordion.Content>
              Open an issue on <a href={ISSUES_URL} className="inline-link">GitHub</a>: bugs, questions and ideas
              are all welcome there.
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Group>
      </div>
    </section>
  )
}
