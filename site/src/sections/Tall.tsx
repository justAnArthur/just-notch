import { TALL } from '../data'

/** The island at its tall snap: each picture hangs from the top edge, as it does from the notch. */
export function Tall() {
  return (
    <section className="tall field-screen" aria-labelledby="tall-title">
      <div className="tall-edge" aria-hidden="true" />
      <ul className="tall-row" aria-label="The island at its tall snap">
        {TALL.map((t, i) => (
          <li key={t.src} className="tall-item" data-rv style={{ '--i': i } as React.CSSProperties}>
            <img src={t.src} alt={t.alt} width={720} height={569} loading="lazy" decoding="async" />
            <p className="tall-caption">
              <strong>{t.caption}.</strong> {t.note}
            </p>
          </li>
        ))}
      </ul>
      <div className="tall-copy">
        <h2 className="headline" id="tall-title" data-rv>
          Swipe down for<br /> the whole plugin.
        </h2>
        <p className="body" data-rv style={{ '--i': 1 } as React.CSSProperties}>
          The island opens to fit what it shows. Swipe down on the trackpad and it snaps tall, with the full
          forecast, the scrubber or the process list. Swipe up and it is a notch again.
        </p>
      </div>
    </section>
  )
}
