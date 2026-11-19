export const REPO_URL = 'https://github.com/justAnArthur/just-notch'
// build-macos-on-tag.yml attaches a stable JustNotch.zip to every release.
export const DOWNLOAD_URL = `${REPO_URL}/releases/latest/download/JustNotch.zip`
export const RELEASES_URL = `${REPO_URL}/releases`
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE.md`
export const MODO_URL = 'https://github.com/justAnArthur/modo'
export const QUARANTINE_COMMAND = 'xattr -dr com.apple.quarantine /Applications/JustNotch.app'
export const CREATE_COMMAND = 'bun run notch create my-plugin'
export const LIBRARY_GUIDE_URL = `${REPO_URL}/tree/main/library#readme`
/** Written by scripts/library-catalog.ts (pages.yml); the app reads the same file. */
export const CATALOG_URL = `${import.meta.env.BASE_URL}library/index.json`

const shot = (name: string) => `${import.meta.env.BASE_URL}shots/${name}.png`

/** What each manifest permission lets a plugin read or do, in the visitor's words. */
const PERMISSION: Record<string, string> = {
  'media.read': 'What is playing',
  'media.control': 'Playback controls',
  'audio.read': 'Audio levels',
  'calendar.read': 'Your calendars',
  'weather.read': 'Weather for your place',
  'stats.read': 'System stats',
  'power.read': 'Battery',
  clipboard: 'Clipboard',
  'files.recent': 'Recent files',
  'apps.read': 'Your apps',
  'apps.launch': 'Opening apps',
  'files.search': 'Finding files',
  files: 'Opening files',
  net: 'The network',
  secrets: 'Keychain secrets',
  windows: 'Moving windows',
}

interface Plugin {
  id: string
  name: string
  /** manifest.json's description, verbatim. */
  description: string
  permissions: string[]
  /** The island at its first snap, from packages/runtime/scripts/shots.ts. */
  shot: string
  width: number
  height: number
}

// Copied from plugins/*/manifest.json; the order is the island's own tab order.
const MANIFESTS: Omit<Plugin, 'shot' | 'width' | 'height'>[] = [
  {
    id: 'now-playing',
    name: 'Now Playing',
    description: 'What plays in Music, Spotify or a browser, beside the notch and in the open island.',
    permissions: ['media.read', 'media.control', 'audio.read'],
  },
  { id: 'calendar', name: 'Calendar', description: 'Today and tomorrow, and a countdown to the next event.', permissions: ['calendar.read'] },
  { id: 'clipboard', name: 'Clipboard', description: 'What you copied, kept and searchable.', permissions: ['clipboard'] },
  { id: 'clock', name: 'Clock', description: 'The time, world clocks and a Pomodoro cycle.', permissions: [] },
  {
    id: 'recent-files',
    name: 'Recent files',
    description: 'The newest downloads and screenshots, ready to open or drag out.',
    permissions: ['files.recent', 'files'],
  },
  { id: 'system', name: 'System', description: 'CPU, memory, battery, disk and the busiest processes.', permissions: ['stats.read', 'power.read'] },
  { id: 'weather', name: 'Weather', description: 'The temperature now, the next hours and rain on its way.', permissions: ['weather.read'] },
]

// Pixel sizes of the screenshots in public/shots (2x).
const FIT: Record<string, [number, number]> = {
  'now-playing': [1440, 474],
  calendar: [1440, 402],
  clipboard: [1440, 498],
  clock: [1440, 406],
  'recent-files': [1440, 418],
  system: [1440, 462],
  weather: [1440, 462],
}

export const PLUGINS: Plugin[] = MANIFESTS.map((m) => ({
  ...m,
  shot: shot(`${m.id}-fit`),
  width: FIT[m.id]![0],
  height: FIT[m.id]![1],
}))

export const permissionLabel = (id: string) => PERMISSION[id] ?? id

/** The island at its tall snap: a swipe down from the first. */
export const TALL = [
  { src: shot('weather-tall'), alt: 'The Weather plugin at the tall snap: Bratislava at 7 degrees, the next 24 hours and a 7-day forecast.', caption: 'Weather', note: 'The next 24 hours, seven days and the details.' },
  { src: shot('now-playing-tall'), alt: 'The Now Playing plugin at the tall snap: Midnight City by M83 with a scrubber, controls and the output device.', caption: 'Now Playing', note: 'The scrubber, the controls and where it plays.' },
  { src: shot('system-tall'), alt: 'The System plugin at the tall snap: CPU load, memory pressure, network, battery, disk and the top processes.', caption: 'System', note: 'Load, memory, network, battery and the busiest processes.' },
]

export const SETTINGS = {
  src: shot('settings'),
  alt: 'Just Notch settings inside the island: launch at login, which screens show the island, and a settings page for each plugin.',
}

/** What the launcher finds, in the order its results come (packages/runtime/src/launcher/providers.ts). */
export const LAUNCHER_FINDS = [
  { name: 'Applications', note: 'Ranked by how often and how recently you open them.' },
  { name: 'Answers', note: 'Maths, units, currencies at ECB rates, time zones (“time in tokyo”), dates and number bases, inline.' },
  { name: 'Files', note: 'From the Spotlight index, with a Quick Look preview.' },
  { name: 'Actions', note: 'Sleep, Turn Off Display, Start Screen Saver, Empty Trash, Toggle Dark Mode and your Shortcuts.' },
  { name: 'Clipboard', note: 'Your history: Return pastes straight into the app in front.' },
  { name: 'Window Management', note: 'Halves, quarters, thirds, sixths, maximize and the next display for the window in front.' },
  { name: 'Web', note: 'A web search when nothing else fits.' },
]

/** The launcher's keys (packages/runtime/src/launcher/launcher.tsx). */
export const LAUNCHER_KEYS = [
  { keys: '⌥Space', does: 'Open it, or the shortcut you set' },
  { keys: '↩', does: 'Open, paste or copy' },
  { keys: '⌘↩', does: 'The second action: show in Finder, copy' },
  { keys: '⇧↩', does: 'The third: copy the path, paste as plain text' },
  { keys: '⌘K', does: 'Every action of the result' },
  { keys: '⌘1–⌘6', does: 'A scope: Applications, Files, Actions, Clipboard' },
  { keys: '⌘Y', does: 'The preview pane' },
  { keys: 'Tab', does: 'Complete the result into the field' },
  { keys: 'Esc', does: 'Clear, leave the scope, close' },
]
