import Badge from '@justanarthur/modo-ui/components/data-display/badge'
import Button from '@justanarthur/modo-ui/components/actions/button'
import { ArrowDownToLine, Check } from 'lucide-react'
import { DOWNLOAD_URL } from '../data'

// Phase 0: nothing is for sale yet. Free lists what today's build does; Pro, what docs/plans/revenue.md plans
// for it. The price, trial, devices and refund window come with the notarized build.
const FREE = ['The island and the seven plugins', 'The ⌥Space launcher', 'Window moves from the launcher', 'Clipboard history', 'Updates from GitHub']
const PRO = ['Everything in Free', 'Snippets, quicklinks, an emoji picker and a file shelf', 'Unlimited clipboard history with pinboards', 'Window shortcuts and layouts', 'Themes and a layout per display']

function Tier({ name, note, items, children }: { name: string; note: string; items: string[]; children: React.ReactNode }) {
  return (
    <article className="tier" data-rv>
      <header className="tier-head">
        <h3 className="tier-name">{name}</h3>
        <p className="tier-note">{note}</p>
      </header>
      <ul className="tier-list">
        {items.map((item) => (
          <li key={item}>
            <Check size={16} strokeWidth={1.75} aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
      <div className="tier-foot">{children}</div>
    </article>
  )
}

export function Pricing() {
  return (
    <section className="pricing field-ink" id="pricing" aria-labelledby="pricing-title">
      <div className="pricing-head">
        <h2 className="headline" id="pricing-title" data-rv>
          Free today.<br /> Pro later, once.
        </h2>
        <p className="body" data-rv style={{ '--i': 1 } as React.CSSProperties}>
          Every build on GitHub is free today. Pro comes with the notarized, auto-updating build: one payment, no
          subscription. Its price, trial, devices and refund window will be on this page
          before anything is for sale.
        </p>
      </div>
      <div className="tiers">
        <Tier name="Free" note="Everything you download today." items={FREE}>
          <Button className="cta brand-action" leadingIcon={ArrowDownToLine} render={<a href={DOWNLOAD_URL} />}>
            Download for Mac
          </Button>
        </Tier>
        <Tier name="Pro" note="One payment, with updates. Price at launch." items={PRO}>
          <Badge variant="outline">Coming with the notarized build</Badge>
        </Tier>
      </div>
    </section>
  )
}
