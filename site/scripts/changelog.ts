/**
 * Writes the changelog the site's /changelog/ page reads to public/changelog.json, from the app's GitHub
 * releases (`just-notch@x.y.z`, stable only). Each release's notes come from release-on-tag.yml:
 * `#### <scope>` headings over `- **<type>**: <text>` lines. Only what a user notices is kept (feat, fix,
 * perf), grouped under the part of the app it touches.
 *
 *   bun scripts/changelog.ts      (gh api, GH_TOKEN; GITHUB_REPOSITORY, default justAnArthur/just-notch)
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface NotesRelease {
  tag_name: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
  html_url: string
  body: string | null
}

export type ChangeKind = 'new' | 'fixed' | 'faster'

export interface ChangelogEntry {
  version: string
  date: string
  url: string
  groups: { area: string; changes: { kind: ChangeKind; text: string }[] }[]
}

const KIND: Record<string, ChangeKind> = { feat: 'new', fix: 'fixed', perf: 'faster' }

// Commit scopes in the visitor's words; the app's own internals read as "The app".
const AREA: Record<string, string> = {
  app: 'The app',
  macos: 'The app',
  host: 'The app',
  services: 'The app',
  runtime: 'The app',
  island: 'The island',
  launcher: 'Launcher',
  windows: 'Window management',
  'now-playing': 'Now Playing',
  calendar: 'Calendar',
  clipboard: 'Clipboard',
  clock: 'Clock',
  'recent-files': 'Recent files',
  system: 'System',
  weather: 'Weather',
  sdk: 'Plugin SDK',
  cli: 'Plugin SDK',
  'bridge-schema': 'Plugin SDK',
  plugins: 'Plugins',
}

const areaOf = (scope: string) => AREA[scope] ?? scope.charAt(0).toUpperCase() + scope.slice(1).replace(/-/g, ' ')

/** The user-facing changes in one release's notes, by area, in the order the areas first appear. */
export function parseNotes(body: string) {
  const groups = new Map<string, { kind: ChangeKind; text: string }[]>()
  let area: string | undefined
  for (const line of body.split('\n')) {
    const heading = line.match(/^####\s+(.+?)\s*$/)
    if (heading) {
      area = heading[1] === 'Other Changes' ? undefined : areaOf(heading[1]!)
      continue
    }
    const item = line.match(/^-\s+\*\*(\w+)\*\*:\s+(.+?)\s*$/)
    const kind = item && KIND[item[1]!]
    if (!area || !item || !kind) continue
    const text = item[2]!
    const list = groups.get(area) ?? []
    if (!list.some((change) => change.text === text)) list.push({ kind, text: text.charAt(0).toUpperCase() + text.slice(1) })
    groups.set(area, list)
  }
  return [...groups].map(([area, changes]) => ({ area, changes }))
}

/** Stable app releases, newest first, each with its user-facing changes; releases with none are left out. */
export function buildChangelog(releases: NotesRelease[]): ChangelogEntry[] {
  return releases
    .filter((r) => !r.draft && !r.prerelease && r.published_at && /^just-notch@\d+\.\d+\.\d+$/.test(r.tag_name))
    .map((r) => ({
      version: r.tag_name.slice('just-notch@'.length),
      date: r.published_at!.slice(0, 10),
      url: r.html_url,
      groups: parseNotes(r.body ?? ''),
    }))
    .filter((entry) => entry.groups.length)
    .sort((a, b) => b.date.localeCompare(a.date) || b.version.localeCompare(a.version, undefined, { numeric: true }))
}

function githubReleases(repo: string): NotesRelease[] {
  const out = execFileSync(
    'gh',
    ['api', `repos/${repo}/releases?per_page=100`, '--paginate', '--jq', '.[] | {tag_name, draft, prerelease, published_at, html_url, body}'],
    { encoding: 'utf8', maxBuffer: 64 << 20 },
  )
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as NotesRelease)
}

if (import.meta.main) {
  const site = resolve(import.meta.dirname, '..')
  const entries = buildChangelog(githubReleases(process.env.GITHUB_REPOSITORY || 'justAnArthur/just-notch'))
  writeFileSync(join(site, 'public/changelog.json'), `${JSON.stringify(entries, null, 2)}\n`)
  console.log(`changelog.json: ${entries.length} release(s)`)
}
