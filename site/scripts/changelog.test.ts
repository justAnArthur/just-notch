import { describe, expect, test } from 'bun:test'
import { buildChangelog, type NotesRelease, parseNotes } from './changelog'

const NOTES = `## Release Notes

### Changes

#### calendar
- **feat**: one mark per wing, minutes in the bubble

#### services
- **feat**: animate window moves
- **chore**: bump deps

#### windows
- **fix**: say macOS tiles windows too
#### runtime
- **perf**: faster first paint

#### Other Changes
- **feat**: something unscoped
`

const release = (tag: string, date: string, extra: Partial<NotesRelease> = {}): NotesRelease => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  published_at: `${date}T12:00:00Z`,
  html_url: `https://github.com/x/y/releases/tag/${tag}`,
  body: NOTES,
  ...extra,
})

describe('parseNotes', () => {
  test('keeps feat, fix and perf, in the visitor’s words, by area', () => {
    expect(parseNotes(NOTES)).toEqual([
      { area: 'Calendar', changes: [{ kind: 'new', text: 'One mark per wing, minutes in the bubble' }] },
      { area: 'The app', changes: [{ kind: 'new', text: 'Animate window moves' }, { kind: 'faster', text: 'Faster first paint' }] },
      { area: 'Window management', changes: [{ kind: 'fixed', text: 'Say macOS tiles windows too' }] },
    ])
  })
})

describe('buildChangelog', () => {
  test('stable app releases only, newest first, empty ones dropped', () => {
    const entries = buildChangelog([
      release('just-notch@1.8.0', '2026-11-19'),
      release('just-notch@1.9.0', '2026-11-20'),
      release('just-notch@2.0.0-beta.1', '2026-11-21', { prerelease: true }),
      release('@just-notch/plugin-demo@0.2.1', '2026-11-21'),
      release('just-notch@1.8.1', '2026-11-20', { body: '## Release Notes\n\n#### Other Changes\n- **chore**: x' }),
    ])
    expect(entries.map((e) => e.version)).toEqual(['1.9.0', '1.8.0'])
    expect(entries[0]!.date).toBe('2026-11-20')
  })
})
