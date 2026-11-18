/**
 * The host ⇄ web contract. Single source of truth: the Swift host mirrors these
 * shapes by hand as Codable types (apps/macos), so any change here is a change
 * there in the same commit.
 *
 * Transport
 * - JS → Swift: `window.webkit.messageHandlers.host.postMessage(request)` through
 *   `WKScriptMessageHandlerWithReply`; the promise resolves with `Methods[M]['result']`
 *   (JSON) or rejects with a string message.
 * - Swift → JS: `window.__notch.dispatch(events)` with an array of `HostEvent`,
 *   coalesced to at most one call per display frame.
 *
 * Coordinates are in points, in the panel's own space: origin top-left, y down.
 * Timestamps are milliseconds since the Unix epoch.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Permission =
  | 'media.read'
  | 'media.control'
  | 'power.read'
  | 'audio.read'
  | 'audio.control'
  | 'display.control'
  | 'hud'
  | 'calendar.read'
  | 'files'
  | 'bluetooth.read'
  | 'stats.read'
  | 'weather.read'
  | 'clipboard'
  | 'files.recent'
  /** `net.*`: HTTP(S) to the manifest's `hosts` and hosts the user granted. */
  | 'net'
  /** `secrets.*`: per-plugin strings in the Keychain (tokens, passwords). */
  | 'secrets'

/** `manifest.json` at a plugin's root. */
export interface PluginManifest {
  /** Kebab-case, unique; also the folder name. */
  id: string
  name: string
  version: string
  description?: string
  /** ESM entry relative to the plugin root, default-exporting `definePlugin(...)`. */
  entry: string
  /** Optional stylesheet relative to the plugin root (UnoCSS output of `notch build`). */
  style?: string
  /** Optional icon (`.png` or `.svg`) relative to the plugin root, outside `dist/`; shipped in the `.notchplugin`. */
  icon?: string
  permissions: Permission[]
  /**
   * Hostnames `net.fetch` may reach without asking, such as `api.github.com`, `*.youtrack.cloud` or
   * `host:8443`: no scheme, no path. `*.` matches subdomains only, and needs at least two labels after it.
   * Needs the `net` permission.
   */
  hosts?: string[]
  /** The plugin API (`API_VERSION`) range it's written against, such as `^1.1.0`. Checked for user and library plugins. */
  engines: { notch: string }
}

/** Bundled with the app, copied into the user plugins folder by hand (`notch install`), or installed from the library. */
export type PluginSource = 'builtIn' | 'user' | 'library'

export interface InstalledPlugin {
  manifest: PluginManifest
  /** Absolute URL of the plugin folder, ending in `/` (`notch://app/plugins/<id>/`). */
  baseUrl: string
  enabled: boolean
  /** `source === 'builtIn'`. */
  builtIn: boolean
  source: PluginSource
  /** Why it can't run here (its `engines.notch` doesn't match `API_VERSION`): listed, never loaded. */
  incompatible?: string
}

export interface ScreenGeometry {
  /** The panel's size; the island never draws outside it. */
  panel: { w: number; h: number }
  /** The hardware notch in panel coordinates; a virtual one on screens without a notch. */
  notch: Rect
  hasNotch: boolean
  scale: number
  /** Stable id of the screen this panel sits on. */
  screenId: string
}

// ── Plugin API version ──

/**
 * The plugin API's version and the node-semver subset `engines.notch` is checked with: `^ ~ >= > <= < =`,
 * x-ranges (`1.x`, `1.2`, `*`), hyphen ranges (`1.2 - 2`) and `||`. A prerelease version satisfies a set only
 * when one of its comparators names the same `major.minor.patch` with a prerelease, as in node-semver.
 *
 * The Swift host mirrors this (NotchServices `Plugins/SemverRange.swift`); both run `test/semver-cases.json`.
 */

/**
 * What plugins are written against: the bridge's methods, topics and events and the SDK. Bump the minor for
 * an addition, the major for a break; user and library plugins whose `engines.notch` doesn't match aren't loaded.
 * 1.0 is the surface plugins first shipped against, 1.1 adds `net` and `secrets`.
 */
export const API_VERSION = '1.1.0'

interface Version {
  major: number
  minor: number
  patch: number
  pre: string[]
}

type Op = '<' | '<=' | '>' | '>=' | '='

interface Comparator {
  op: Op
  version: Version
}

const IDENT = '[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*'
const VERSION = new RegExp(`^v?(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${IDENT}))?(?:\\+${IDENT})?$`)
const PARTIAL = new RegExp(`^v?(\\d+|[xX*])(?:\\.(\\d+|[xX*]))?(?:\\.(\\d+|[xX*]))?(?:-(${IDENT}))?(?:\\+${IDENT})?$`)
const HYPHEN = /^(\S+)\s+-\s+(\S+)$/
const OPERATOR = /^(<=|>=|<|>|=|\^|~)?(.*)$/
/** `-0`, the lowest prerelease: `<2.0.0-0` keeps out 2.0.0's prereleases. */
const LOW = ['0']

const version = (major: number, minor: number, patch: number, pre: string[] = []): Version => ({ major, minor, patch, pre })

function parseVersion(value: string): Version | undefined {
  const match = VERSION.exec(value.trim())
  if (!match) return undefined
  return version(Number(match[1]), Number(match[2]), Number(match[3]), match[4]?.split('.') ?? [])
}

function compareIdentifiers(a: string, b: string): number {
  const numeric = /^\d+$/
  if (numeric.test(a) && numeric.test(b)) return Math.sign(Number(a) - Number(b))
  if (numeric.test(a)) return -1
  if (numeric.test(b)) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

function compare(a: Version, b: Version): number {
  const core = Math.sign(a.major - b.major) || Math.sign(a.minor - b.minor) || Math.sign(a.patch - b.patch)
  if (core) return core
  if (!a.pre.length || !b.pre.length) return Math.sign(b.pre.length - a.pre.length)
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const order = compareIdentifiers(a.pre[i], b.pre[i])
    if (order) return order
  }
  return Math.sign(a.pre.length - b.pre.length)
}

/** -1, 0 or 1 by semver precedence (build metadata ignored); a malformed version sorts before every valid one. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [x, y] = [parseVersion(a), parseVersion(b)]
  if (!x || !y) return x ? 1 : y ? -1 : 0
  return compare(x, y) as -1 | 0 | 1
}

/** The comparators a partial version with an operator stands for; `null` when it matches nothing. */
function desugar(op: string, value: string): Comparator[] | null | undefined {
  const match = PARTIAL.exec(value)
  if (!match) return undefined
  const [major, minor, patch] = [match[1], match[2], match[3]].map((part) => (part === undefined || /[xX*]/.test(part) ? undefined : Number(part)))
  // Once a part is a wildcard, the ones after it are too: `1.x.3` reads as `1.x`.
  const M = major
  const m = M === undefined ? undefined : minor
  const p = m === undefined ? undefined : patch
  const pre = p !== undefined && match[4] ? match[4].split('.') : []
  if (M === undefined) return op === '<' || op === '>' ? null : []

  const nextMajor = version(M + 1, 0, 0, LOW)
  const next = m === undefined ? nextMajor : version(M, m + 1, 0, LOW)
  const lowest = version(M, m ?? 0, p ?? 0, pre)
  switch (op) {
    case '':
    case '=':
      return p === undefined ? [{ op: '>=', version: lowest }, { op: '<', version: next }] : [{ op: '=', version: lowest }]
    case '~':
      return [{ op: '>=', version: lowest }, { op: '<', version: next }]
    case '^': {
      const upper = M > 0 || m === undefined ? nextMajor : m > 0 || p === undefined ? version(0, m + 1, 0, LOW) : version(0, 0, p + 1, LOW)
      return [{ op: '>=', version: lowest }, { op: '<', version: upper }]
    }
    case '>':
      return p === undefined ? [{ op: '>=', version: version(next.major, next.minor, 0) }] : [{ op: '>', version: lowest }]
    case '>=':
      return [{ op: '>=', version: lowest }]
    case '<':
      return [{ op: '<', version: p === undefined ? version(M, m ?? 0, 0, LOW) : lowest }]
    case '<=':
      return p === undefined ? [{ op: '<', version: next }] : [{ op: '<=', version: lowest }]
  }
  return undefined
}

/** One `||` alternative: its comparators, `null` when it matches nothing, `undefined` when it doesn't parse. */
function parseSet(set: string): Comparator[] | null | undefined {
  const hyphen = HYPHEN.exec(set)
  if (hyphen) {
    const [low, high] = [desugar('>=', hyphen[1]), desugar('<=', hyphen[2])]
    if (low === undefined || high === undefined) return undefined
    return low && high ? [...low, ...high] : null
  }
  const comparators: Comparator[] = []
  let none = false
  // `>= 1.2.0` is `>=1.2.0`.
  for (const token of set.replace(/(<=|>=|<|>|=|\^|~)\s+/g, '$1').split(/\s+/).filter(Boolean)) {
    const [, op = '', rest] = OPERATOR.exec(token)!
    const desugared = desugar(op, rest)
    if (desugared === undefined) return undefined
    if (desugared === null) none = true
    else comparators.push(...desugared)
  }
  return none ? null : comparators
}

function test({ op, version: bound }: Comparator, v: Version): boolean {
  const order = compare(v, bound)
  return op === '<' ? order < 0 : op === '<=' ? order <= 0 : op === '>' ? order > 0 : op === '>=' ? order >= 0 : order === 0
}

/** Whether `version` is in `range`; false when either doesn't parse. */
export function satisfies(value: string, range: string): boolean {
  const v = parseVersion(value)
  if (!v) return false
  const sets = range.split('||').map((set) => parseSet(set.trim()))
  if (sets.includes(undefined)) return false
  return sets.some((set) => {
    if (!set || !set.every((c) => test(c, v))) return false
    if (!v.pre.length) return true
    return set.some((c) => c.version.pre.length > 0 && c.version.major === v.major && c.version.minor === v.minor && c.version.patch === v.patch)
  })
}

// ── Topics: values the host publishes while at least one subscriber exists ──

export type MediaRepeat = 'off' | 'all' | 'one'

export interface MediaState {
  playing: boolean
  title: string
  artist: string
  album: string
  /** `data:` URL or `notch://app/...` URL; absent while unknown. */
  artworkUrl?: string
  durationS: number
  /** Position at `updatedAt`; the web extrapolates with `rate`. */
  positionS: number
  rate: number
  updatedAt: number
  /** Bundle id of the playing app. */
  sourceApp?: string
  /** Shuffle is on (by songs or albums); absent when the player doesn't report it. */
  shuffle?: boolean
  /** Absent when the player doesn't report it. */
  repeat?: MediaRepeat
  /** The modes the player takes (Spotify: `off`, `all`); absent: all three. */
  repeatModes?: MediaRepeat[]
  /** The track is liked; absent when the player doesn't support likes. */
  liked?: boolean
}

export interface PowerState {
  percent: number // 0…100
  charging: boolean
  pluggedIn: boolean
  /** Minutes until empty / full; absent while the system estimates. */
  minutesRemaining?: number
  lowPowerMode: boolean
  hasBattery: boolean
}

export interface AudioState {
  volume: number // 0…1
  muted: boolean
  outputDevice: string
}

export interface CalendarEvent {
  id: string
  title: string
  start: number
  end: number
  allDay: boolean
  calendarColor: string // `#rrggbb` from EventKit; plugin data, not a theme value
  location?: string
  meetingUrl?: string
}

export interface CalendarState {
  access: 'granted' | 'denied' | 'undetermined'
  /** Events from now until the end of the sixth day ahead, sorted by start. */
  upcoming: CalendarEvent[]
}

export interface BluetoothDevice {
  id: string
  name: string
  kind: 'headphones' | 'keyboard' | 'mouse' | 'speaker' | 'other'
  connected: boolean
  batteryPercent?: number // 0…100
}

export interface StatsState {
  cpu: number // 0…1
  memoryUsed: number // bytes
  memoryTotal: number
  memoryPressure: 'normal' | 'warning' | 'critical'
  netInBps: number
  netOutBps: number
  /** Startup volume, bytes; free counts purgeable space as Finder does. */
  diskFree: number
  diskTotal: number
  uptimeS: number
}

/** The busiest processes by CPU, sampled while `processes` is subscribed. */
export interface ProcessSample {
  pid: number
  name: string
  /** Share of all cores, 0…1. */
  cpu: number
  /** Resident memory, bytes. */
  memory: number
}

// Weather: Open-Meteo, metric units (°C, km/h); conditions are WMO weather codes.

export interface WeatherNow {
  time: number
  temperature: number
  apparent: number
  code: number
  isDay: boolean
  wind: number
  humidity: number // %
  uv: number
}

export interface WeatherHour {
  time: number
  temperature: number
  code: number
  isDay: boolean
  precipitation: number // probability, %
}

export interface WeatherDay {
  /** Local midnight of the day. */
  date: number
  code: number
  high: number
  low: number
  precipitation: number // probability, %
  sunrise?: number
  sunset?: number
}

export type WeatherLocation = { mode: 'auto' } | { mode: 'city'; city: string }

export interface WeatherState {
  /** Location Services; `granted` regardless when the location is a city. */
  access: 'granted' | 'denied' | 'undetermined'
  /** `offline` / `error` keep the last forecast. */
  status: 'ready' | 'loading' | 'error' | 'offline'
  setting: WeatherLocation
  /** City name of the forecast's place. */
  location?: string
  current?: WeatherNow
  /** The next 24 hours, from the current one. */
  hours: WeatherHour[]
  /** 7 days, today first. */
  days: WeatherDay[]
  updatedAt?: number
}

export type ClipKind = 'text' | 'link' | 'image' | 'color' | 'file'

export interface Clip {
  id: string
  kind: ClipKind
  /** Text, URL, `#rrggbb`, or the file path; an image's dimensions (`1280×720`). */
  content: string
  /** File name, or a byte size for images. */
  detail?: string
  /** `data:` URL thumbnail of an image or file. */
  preview?: string
  /** Name of the app it was copied in. */
  app?: string
  copiedAt: number
  pinned: boolean
}

export interface ClipboardState {
  /** Newest first, pinned clips included. */
  clips: Clip[]
  paused: boolean
  /** Bundle ids whose copies are never recorded. */
  ignoredApps: string[]
}

/** An app the user can pick, e.g. to ignore its copies. */
export interface AppInfo {
  bundleId: string
  name: string
  /** Small `data:` PNG of the app's icon. */
  icon?: string
}

export interface RecentFile {
  /** Also the absolute path. */
  id: string
  name: string
  size: number // bytes
  addedAt: number
  source: 'downloads' | 'screenshots'
  /** Host the file was downloaded from. */
  from?: string
}

/** A download still being written (`.download`, `.crdownload`, `.part`). */
export interface ActiveDownload {
  id: string
  name: string
  received: number // bytes
  /** Expected size in bytes, when the browser records it (Safari). */
  total?: number
  /** Bytes per second over the last sample. */
  rate: number
  from?: string
}

export interface RecentFolder {
  path: string
  /** Chosen with `recentFiles.chooseFolder`; otherwise the system's (Downloads, or the Screenshot app's folder). */
  custom: boolean
}

export interface RecentFilesState {
  /** The Downloads and screenshot folders are privacy-protected; `denied` until the user allows them. */
  access: 'granted' | 'denied'
  /** Newest first, per source at most 20, after the source's last `recentFiles.clear`. */
  files: RecentFile[]
  /** Downloads still being written, in the downloads folder. */
  downloads: ActiveDownload[]
  /** The folder each source watches. */
  folders: Record<RecentFile['source'], RecentFolder>
}

export interface DisplayState {
  brightness: number // 0…1, built-in display
  /** Keyboard backlight 0…1; absent when the Mac has none or it can't be read. */
  keyboardBacklight?: number
}

export interface Topics {
  media: MediaState | null
  power: PowerState
  audio: AudioState
  display: DisplayState
  calendar: CalendarState
  bluetooth: BluetoothDevice[]
  stats: StatsState
  processes: ProcessSample[]
  weather: WeatherState
  clipboard: ClipboardState
  recentFiles: RecentFilesState
}
export type Topic = keyof Topics

/** The permission a plugin's manifest needs to subscribe to each topic. */
export const TOPIC_PERMISSION: Record<Topic, Permission> = {
  media: 'media.read',
  power: 'power.read',
  audio: 'audio.read',
  calendar: 'calendar.read',
  bluetooth: 'bluetooth.read',
  stats: 'stats.read',
  processes: 'stats.read',
  display: 'display.control',
  weather: 'weather.read',
  clipboard: 'clipboard',
  recentFiles: 'files.recent',
}

// ── Methods: JS → Swift requests ──

export interface HostInfo {
  version: string
  /** `API_VERSION` of the host: what plugins' `engines.notch` is checked against. */
  apiVersion: string
  devMode: boolean
  /** In dev the runtime is served by Vite at this origin; plugins too. */
  devServerUrl?: string
  plugins: InstalledPlugin[]
  geometry: ScreenGeometry
}

export type MediaCommand =
  | { command: 'play' | 'pause' | 'toggle' | 'next' | 'previous' }
  | { command: 'seek'; positionS: number }
  | { command: 'shuffle'; shuffle: boolean }
  | { command: 'repeat'; repeat: MediaRepeat }
  | { command: 'like'; liked: boolean }

// ── Net: HTTP(S) on a plugin's behalf, without CORS ──

export type NetMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

export interface NetRequest {
  /** `https:`; `http:` only for local hosts (localhost, `*.local`, private IPs). */
  url: string
  /** @default 'GET' */
  method?: NetMethod
  /** `Host`, `Content-Length`, `Connection` and `Cookie` are dropped. */
  headers?: Record<string, string>
  body?: string
  /** Sent as JSON with `content-type: application/json` (unless set); exclusive with `body`. */
  json?: unknown
  /** @default 15000, clamped to 1000–60000 */
  timeoutMs?: number
  /** @default 'text' for text, JSON and XML content types, else 'base64' */
  responseType?: 'text' | 'base64'
}

export interface NetResponse {
  status: number
  /** The final URL, after redirects. */
  url: string
  /** Lowercased names. */
  headers: Record<string, string>
  body: string
  encoding: 'text' | 'base64'
}

/** A larger response rejects; it is never truncated. */
export const NET_MAX_RESPONSE_BYTES = 5 * 1024 * 1024
export const NET_DEFAULT_TIMEOUT_MS = 15_000
export const NET_DROPPED_HEADERS = ['host', 'content-length', 'connection', 'cookie']

export function netTimeout(timeoutMs: number | undefined): number {
  return Math.min(60_000, Math.max(1_000, timeoutMs ?? NET_DEFAULT_TIMEOUT_MS))
}

/** The response type a content type defaults to. */
export function netResponseType(contentType: string | null | undefined): 'text' | 'base64' {
  const type = (contentType ?? '').toLowerCase()
  return type.startsWith('text/') || type.includes('json') || type.includes('xml') ? 'text' : 'base64'
}

const WILDCARD = '*.'
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

/** `host`, `host:port` or `*.domain.tld[:port]`, lowercase; a wildcard needs two labels after `*.`. */
export function validHostPattern(pattern: string): boolean {
  const [host, port, ...rest] = pattern.split(':')
  if (rest.length > 0 || (port !== undefined && !/^[1-9]\d{0,4}$/.test(port))) return false
  if (port !== undefined && Number(port) > 65_535) return false
  const wildcard = host.startsWith(WILDCARD)
  const labels = (wildcard ? host.slice(WILDCARD.length) : host).split('.')
  if (wildcard && labels.length < 2) return false
  return labels.every((label) => LABEL.test(label))
}

/** localhost, `*.localhost`, `*.local`, loopback and private IPv4, IPv6 loopback and unique-local. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host)) return true
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  const [a, b] = host.split('.').map(Number)
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** `https:`, or `http:` to a local host. */
export function netSchemeAllowed(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHost(url.hostname))
}

/** The `host[:port]` a grant is stored under (`url.host`, lowercased; default ports left out). */
export function netHostKey(url: URL): string {
  return url.host.toLowerCase()
}

/**
 * Whether `url`'s host matches one of `patterns` (see `PluginManifest.hosts`). A pattern without a port
 * matches any port; invalid patterns match nothing.
 */
export function hostAllowed(patterns: readonly string[], url: string | URL): boolean {
  let parsed: URL
  try {
    parsed = typeof url === 'string' ? new URL(url) : url
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : '')
  return patterns.some((pattern) => {
    if (!validHostPattern(pattern)) return false
    const [patternHost, patternPort] = pattern.split(':')
    if (patternPort !== undefined && patternPort !== port) return false
    if (!patternHost.startsWith(WILDCARD)) return host === patternHost
    return host.endsWith(patternHost.slice(1))
  })
}

// ── Library: optional plugins, released on their own and listed in one catalog ──

/** `library/index.json` on the site. Lists only each plugin's latest version. */
export interface LibraryCatalog {
  schema: 1
  /** ISO 8601. */
  generatedAt: string
  plugins: LibraryEntry[]
  /** Reserved for a signature over the catalog; not checked yet. */
  signature?: string
}

/** A plugin in the catalog: its packed manifest's fields plus where to get it. URLs are absolute. */
export interface LibraryEntry {
  id: string
  name: string
  description?: string
  version: string
  engines: { notch: string }
  permissions: Permission[]
  hosts: string[]
  author?: string
  homepage?: string
  /** Its source, such as `https://github.com/justAnArthur/just-notch/tree/main/library/github`. */
  source: string
  /** The `.notchplugin` (a zip) on the plugin's GitHub release, its SHA-256 (hex) and size in bytes. */
  download: { url: string; sha256: string; size: number }
  icon?: string
  screenshots: string[]
  /** ISO 8601. */
  releasedAt: string
}

export type LibraryPhase = 'downloading' | 'verifying' | 'installing' | 'done' | 'error'

export interface Methods {
  /** Sent once by the runtime after it has installed `window.__notch`. */
  'host.ready': { params: Record<string, never>; result: HostInfo }
  'host.log': { params: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }; result: null }

  /** Clicks inside these rects reach the page; everything else passes through to apps below. */
  'window.setHitRegions': { params: { rects: Rect[] }; result: null }
  /** Lets the panel become key so text fields can take focus; the runtime sets it while expanded. */
  'window.setFocusable': { params: { focusable: boolean }; result: null }
  /** Opens the island on its settings page (the tall snap). */
  'window.openSettings': { params: Record<string, never>; result: null }
  /** The page took the current trackpad gesture as a swipe: the host holds back the rest of it (and its momentum) until the fingers touch down again. */
  'window.endGesture': { params: Record<string, never>; result: null }
  /** Trackpad haptic feedback (Force Touch trackpads; a no-op elsewhere). `alignment` for snapping, `levelChange` for steps. */
  'window.haptic': { params: { pattern: 'generic' | 'alignment' | 'levelChange' }; result: null }

  subscribe: { params: { topic: Topic }; result: Topics[Topic] }
  unsubscribe: { params: { topic: Topic }; result: null }

  'media.command': { params: MediaCommand; result: null }
  'audio.setVolume': { params: { volume: number }; result: null }
  'display.setBrightness': { params: { brightness: number }; result: null }
  'display.setKeyboardBacklight': { params: { level: number }; result: null }
  /** While enabled the host intercepts volume / brightness keys and sends `hud` events instead of the system HUD. Needs Accessibility. */
  'hud.setEnabled': { params: { enabled: boolean }; result: { enabled: boolean } }

  'calendar.requestAccess': { params: Record<string, never>; result: { granted: boolean } }

  'weather.requestAccess': { params: Record<string, never>; result: { granted: boolean } }
  'weather.setLocation': { params: WeatherLocation; result: null }
  'weather.refresh': { params: Record<string, never>; result: null }

  /** Puts a clip back on the pasteboard. */
  'clipboard.copy': { params: { id: string }; result: null }
  'clipboard.delete': { params: { id: string }; result: null }
  'clipboard.pin': { params: { id: string; pinned: boolean }; result: null }
  /** Drops every clip but the pinned ones. */
  'clipboard.clear': { params: Record<string, never>; result: null }
  'clipboard.setPaused': { params: { paused: boolean }; result: null }
  'clipboard.setIgnoredApps': { params: { apps: string[] }; result: null }
  /** Running regular apps and those in the Applications folders, one per bundle id, sorted by name. */
  'apps.list': { params: Record<string, never>; result: AppInfo[] }

  /** Hides a source's current files from `recentFiles`; nothing is deleted. */
  'recentFiles.clear': { params: { source: RecentFile['source'] }; result: null }
  /** Asks the user for a folder to watch for the source, then rescans; `null` when they cancel. */
  'recentFiles.chooseFolder': { params: { source: RecentFile['source'] }; result: RecentFolder | null }
  /** Watches the system's folder for the source again. */
  'recentFiles.resetFolder': { params: { source: RecentFile['source'] }; result: null }
  /** Moves a download under way (its partial file) to the Trash. */
  'recentFiles.cancelDownload': { params: { id: string }; result: null }

  /** QuickLook thumbnail as a `data:` URL. */
  'files.thumbnail': { params: { path: string; size: number }; result: { url: string } }
  'files.airdrop': { params: { paths: string[] }; result: null }
  'files.reveal': { params: { path: string }; result: null }
  /** Opens with the default app, or with `app`: its name (`Visual Studio Code`), bundle id or path. */
  'files.open': { params: { path: string; app?: string }; result: null }
  /** Call from a `pointerdown`: the host starts a native drag of these files out of the panel. */
  'files.beginDrag': { params: { paths: string[] }; result: null }
  /** Puts the files on the pasteboard, as Finder's Copy does. */
  'files.copy': { params: { paths: string[] }; result: null }
  /** Moves the file to the Trash. */
  'files.trash': { params: { path: string }; result: null }

  /** HTTP(S) to a host in the manifest's `hosts` or one the user granted (`net.requestHost`); no cookies, no cache. */
  'net.fetch': { params: NetRequest; result: NetResponse }
  /** Asks the user, in a native dialog, to let the plugin reach `url`'s exact host[:port]; the grant persists. */
  'net.requestHost': { params: { url: string; reason?: string }; result: { granted: boolean } }
  /** The caller's hosts: its manifest's patterns and the hosts the user granted. */
  'net.hosts': { params: Record<string, never>; result: { manifest: string[]; granted: string[] } }
  'net.revokeHost': { params: { plugin: string; host: string }; result: null }

  /** Per-plugin strings in the Keychain; `null` when unset. Keys match `^[A-Za-z0-9._-]{1,64}$`, values ≤ 64 KB. */
  'secrets.get': { params: { key: string }; result: { value: string | null } }
  'secrets.set': { params: { key: string; value: string }; result: null }
  'secrets.delete': { params: { key: string }; result: null }

  /** Per-plugin JSON storage persisted by the host. */
  'storage.get': { params: { key: string }; result: unknown }
  'storage.set': { params: { key: string; value: unknown }; result: null }

  'system.openUrl': { params: { url: string }; result: null }
  /** Puts plain text on the pasteboard (a web view's `navigator.clipboard` may be refused). */
  'clipboard.writeText': { params: { text: string }; result: null }
  /** The pasteboard's plain text, `''` when it holds none. */
  'clipboard.readText': { params: Record<string, never>; result: { text: string } }
  /** A system notification from Just Notch; asks for permission on first use. */
  'notifications.send': { params: { title: string; body?: string }; result: null }
  /** A system-wide shortcut such as `CommandOrControl+Shift+Space`; `shortcut` events carry the id. Released with the page. */
  'shortcuts.register': { params: { accelerator: string }; result: { id: string } }
  'shortcuts.unregister': { params: { id: string }; result: null }
  /** The `justnotch://` URL the app was launched with, if any. */
  'deepLinks.initial': { params: Record<string, never>; result: { url: string | null } }
  /** Asks the appcast without any UI: `available`, `idle` when up to date, or `error` (also in builds without a Sparkle key). */
  'updater.check': { params: Record<string, never>; result: UpdateState }
  /** Starts Sparkle's own install flow in its window; `updater.state` events follow. */
  'updater.install': { params: Record<string, never>; result: null }
  'permissions.status': {
    params: { permission: 'accessibility' | 'calendar' | 'bluetooth' | 'automation' | 'location' }
    result: { granted: boolean }
  }

  'plugins.setEnabled': { params: { id: string; enabled: boolean }; result: null }
  /** The library's catalog, cached by the host; `refresh` fetches it again. */
  'library.catalog': { params: { refresh?: boolean }; result: LibraryCatalog }
  /**
   * Installs or updates a catalog plugin by id: the host downloads the catalog's URL, checks its size and SHA-256,
   * the packed manifest against the entry and `engines.notch`, then asks the user natively. `library.progress`
   * events follow. Only an id: the page never names what to download.
   */
  'library.install': { params: { id: string }; result: InstalledPlugin }
  /**
   * Asks natively, then moves a user or library plugin to the Trash. The dialog's unchecked “Also delete its saved
   * data and keychain items” drops its storage, secrets, host grants and on/off state too. Rejects when cancelled.
   */
  'library.uninstall': { params: { id: string }; result: null }
  'app.preferences': { params: Record<string, never>; result: AppPreferences }
  'app.setPreferences': { params: Partial<AppPreferences>; result: AppPreferences }
}
/** An update as Sparkle sees it: the platform's `UpdateState` (`@just-apps/host-contract`). */
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; notes?: string }
  /** `progress` runs 0–1; Sparkle's own window shows the bytes, the bridge only start (0) and end (1). */
  | { kind: 'downloading'; progress: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string }

export interface AppPreferences {
  launchAtLogin: boolean
  /** `notched`: only the notched (else built-in, else main) screen; `all`: every screen. */
  screens: 'notched' | 'all'
}

export type Method = keyof Methods

/** A JS → Swift message. `plugin` is the caller's id, or `runtime` for the runtime and the settings page. */
export interface HostRequest<M extends Method = Method> {
  plugin: string
  method: M
  params: Methods[M]['params']
}

/** The permission each gated method needs; methods not listed are open to every plugin. */
export const METHOD_PERMISSION: Partial<Record<Method, Permission>> = {
  'media.command': 'media.control',
  'audio.setVolume': 'audio.control',
  'display.setBrightness': 'display.control',
  'display.setKeyboardBacklight': 'display.control',
  'hud.setEnabled': 'hud',
  'calendar.requestAccess': 'calendar.read',
  'weather.requestAccess': 'weather.read',
  'weather.setLocation': 'weather.read',
  'weather.refresh': 'weather.read',
  'clipboard.copy': 'clipboard',
  'clipboard.delete': 'clipboard',
  'clipboard.pin': 'clipboard',
  'clipboard.clear': 'clipboard',
  'clipboard.setPaused': 'clipboard',
  'clipboard.setIgnoredApps': 'clipboard',
  'apps.list': 'clipboard',
  'recentFiles.clear': 'files.recent',
  'recentFiles.chooseFolder': 'files.recent',
  'recentFiles.resetFolder': 'files.recent',
  'recentFiles.cancelDownload': 'files.recent',
  'files.thumbnail': 'files',
  'files.airdrop': 'files',
  'files.reveal': 'files',
  'files.open': 'files',
  'files.beginDrag': 'files',
  'files.copy': 'files',
  'files.trash': 'files',
  'clipboard.readText': 'clipboard',
  'net.fetch': 'net',
  'net.requestHost': 'net',
  'net.hosts': 'net',
  'net.revokeHost': 'net',
  'secrets.get': 'secrets',
  'secrets.set': 'secrets',
  'secrets.delete': 'secrets',
}

/** Methods only the runtime (`plugin: 'runtime'`) may call. */
export const RUNTIME_ONLY: Method[] = [
  'host.ready',
  'window.setHitRegions',
  'window.setFocusable',
  'window.endGesture',
  'plugins.setEnabled',
  'app.preferences',
  'app.setPreferences',
  'shortcuts.register',
  'shortcuts.unregister',
  'deepLinks.initial',
  'updater.check',
  'updater.install',
  'net.revokeHost',
  'library.catalog',
  'library.install',
  'library.uninstall',
]

/** Methods the runtime may NOT call as `runtime`: they act for one plugin, under its grants and Keychain entries. */
export const PLUGIN_ONLY: Method[] = ['net.fetch', 'net.requestHost', 'net.hosts', 'secrets.get', 'secrets.set', 'secrets.delete']

// ── Events: Swift → JS ──

export interface Events {
  geometry: ScreenGeometry
  /** The pointer entered / left the zone around the notch (native tracking, independent of hit regions). */
  hover: { inside: boolean }
  topic: { [T in Topic]: { topic: T; value: Topics[T] } }[Topic]
  /** Files are being dragged over the panel. */
  'files.dragging': { active: boolean; count: number }
  'files.dropped': { paths: string[] }
  /** A volume / brightness / keyboard-backlight key, while `hud.setEnabled` is on. */
  hud: { kind: 'volume' | 'brightness' | 'keyboard'; value: number; muted?: boolean }
  'bluetooth.connected': BluetoothDevice
  'power.plugged': { pluggedIn: boolean }
  /** A `storage.set` by any web view (island or settings), so both stay in sync. Delivered to every web view. */
  'storage.changed': { plugin: string; key: string; value: unknown }
  /** A secret was set or deleted. Never carries the value: read it again with `secrets.get`. */
  'secrets.changed': { plugin: string; key: string }
  'plugins.changed': { plugins: InstalledPlugin[] }
  /** After `window.endGesture`: the fingers touched the trackpad again, so the next wheel events are a new gesture. */
  'gesture.touch': Record<string, never>
  /** The app menu's Settings…, or `window.openSettings`: the island opens on its settings page. */
  'settings.open': Record<string, never>
  /** A shortcut from `shortcuts.register` was pressed; sent to the page that registered it. */
  shortcut: { id: string }
  /** A `justnotch://` URL was opened while the app runs. */
  'deepLink.open': { url: string }
  /** A step of an update session, wherever it started (Sparkle's scheduled check, the menu, `updater.install`). */
  'updater.state': UpdateState
  /** A step of a `library.install`. */
  'library.progress': { id: string; phase: LibraryPhase; progress?: number; message?: string }
}
export type EventName = keyof Events

export type HostEvent = { [E in EventName]: { type: E; payload: Events[E] } }[EventName]
