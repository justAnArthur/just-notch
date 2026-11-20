export const REPO = 'https://github.com/justAnArthur/just-notch'

export interface Area {
  id: string
  name: string
  changes: string[]
  /** The area's own history: its changelog. */
  history?: string
}

/** The release notes' area headings in words, and where each area's code lives (its history is its changelog). */
const AREAS: Record<string, { name: string; path?: string }> = {
  island: { name: 'Island', path: 'packages/runtime/src/island' },
  launcher: { name: 'Launcher', path: 'packages/runtime/src/launcher' },
  settings: { name: 'Settings', path: 'packages/runtime/src/settings' },
  onboarding: { name: 'Welcome tour', path: 'packages/runtime/src/onboarding' },
  services: { name: 'Under the hood', path: 'apps/macos/Packages/NotchServices' },
  macos: { name: 'Under the hood', path: 'apps/macos' },
  'now-playing': { name: 'Now Playing', path: 'plugins/now-playing' },
  'recent-files': { name: 'Recent files', path: 'plugins/recent-files' },
}

const titleCase = (id: string) => id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/**
 * The release notes (GitHub's release body: `#### area` headings over `- **feat**: what` lines) as areas a buyer
 * reads: commit types dropped, fixes marked, empty areas left out.
 */
export function parseReleaseNotes(body: string): Area[] {
  const areas: Area[] = []
  let current: Area | undefined
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^#{3,4}\s+(.+)$/.exec(line)
    if (heading?.[1]) {
      const id = heading[1].trim().toLowerCase()
      if (id === 'changes' || id === 'release notes') continue
      const known = AREAS[id] ?? (id === 'other changes' ? { name: 'Other changes' } : { name: titleCase(id), path: `plugins/${id}` })
      current = { id, name: known.name, changes: [], history: known.path && `${REPO}/commits/main/${known.path}` }
      areas.push(current)
      continue
    }
    const item = /^[-*]\s+(?:\*\*(\w+)\*\*:\s*)?(.+)$/.exec(line)
    if (!item?.[2] || !current) continue
    const text = item[2].trim().replace(/^\w/, (c) => c.toUpperCase())
    current.changes.push(item[1] === 'fix' ? `Fixed: ${text.replace(/^\w/, (c) => c.toLowerCase())}` : text)
  }
  return areas.filter((area) => area.changes.length > 0)
}

/** The release's tag and pages for a version. */
export const releaseTag = (version: string) => `just-notch@${version}`
export const releasePage = (version: string) => `${REPO}/releases/tag/${encodeURIComponent(releaseTag(version))}`
export const releaseApi = (version: string) => `https://api.github.com/repos/justAnArthur/just-notch/releases/tags/${encodeURIComponent(releaseTag(version))}`
