import { Button } from '@justanarthur/modo-ui'
import { useEffect, useState } from 'react'
import { call, log } from '../host/client'
import { type Area, parseReleaseNotes, REPO, releaseApi, releasePage } from './whats-new'

const openUrl = (url: string) => void call('runtime', 'system.openUrl', { url })
const close = () => void call('runtime', 'onboarding.finish', {})

type Notes = { areas: Area[] } | { error: true } | undefined

/** This version's release notes from GitHub, as areas. */
function useNotes(version: string): Notes {
  const [notes, setNotes] = useState<Notes>()
  useEffect(() => {
    fetch(releaseApi(version), { headers: { Accept: 'application/vnd.github+json' } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((release: { body?: string }) => setNotes({ areas: parseReleaseNotes(release.body ?? '') }))
      .catch((error: unknown) => {
        log('warn', `what's new ${version}: ${String(error)}`)
        setNotes({ error: true })
      })
  }, [version])
  return notes
}

/** What's New, after an update: this version's changes by area, each area linking to its own history. */
export default function WhatsNew({ version }: { version: string }) {
  const notes = useNotes(version)
  return (
    <main className="flex h-screen flex-col gap-4 px-10 pt-10 pb-8 text-foreground">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-title weight-semibold">What's new in Just Notch {version}</h1>
        <p className="m-0 text-body text-muted-foreground">Just Notch updated itself. Here's what changed.</p>
      </div>
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        {!notes && <p className="m-0 px-2 text-body text-muted-foreground">Loading the release notes…</p>}
        {notes && 'error' in notes && (
          <p className="m-0 px-2 text-body text-muted-foreground">Couldn't load the release notes. They're on GitHub.</p>
        )}
        {notes && 'areas' in notes && notes.areas.length === 0 && (
          <p className="m-0 px-2 text-body text-muted-foreground">Small fixes and polish in this one.</p>
        )}
        {notes && 'areas' in notes && notes.areas.length > 0 && (
          <div className="flex flex-col gap-5 px-2">
            {notes.areas.map((area) => (
              <section key={area.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <h2 className="m-0 text-caption weight-medium text-muted-foreground">{area.name}</h2>
                  {area.history && (
                    <Button variant="link" size="compact" onClick={() => area.history && openUrl(area.history)}>
                      History
                    </Button>
                  )}
                </div>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {area.changes.map((change) => (
                    <li key={change} className="text-body">
                      {change}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
      <footer className="flex items-center justify-between">
        <Button variant="link" size="compact" onClick={() => openUrl(notes && 'error' in notes ? releasePage(version) : `${REPO}/releases`)}>
          {notes && 'error' in notes ? 'Open on GitHub' : 'All releases'}
        </Button>
        <Button onClick={close}>Done</Button>
      </footer>
    </main>
  )
}
