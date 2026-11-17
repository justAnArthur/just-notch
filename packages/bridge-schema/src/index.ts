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
  permissions: Permission[]
  engines: { notch: string }
}

export interface InstalledPlugin {
  manifest: PluginManifest
  /** Absolute URL of the plugin folder, ending in `/` (`notch://app/plugins/<id>/`). */
  baseUrl: string
  enabled: boolean
  builtIn: boolean
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

// ── Topics: values the host publishes while at least one subscriber exists ──

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
  devMode: boolean
  /** In dev the runtime is served by Vite at this origin; plugins too. */
  devServerUrl?: string
  plugins: InstalledPlugin[]
  geometry: ScreenGeometry
}

export type MediaCommand =
  | { command: 'play' | 'pause' | 'toggle' | 'next' | 'previous' }
  | { command: 'seek'; positionS: number }

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
  'files.open': { params: { path: string }; result: null }
  /** Call from a `pointerdown`: the host starts a native drag of these files out of the panel. */
  'files.beginDrag': { params: { paths: string[] }; result: null }
  /** Puts the files on the pasteboard, as Finder's Copy does. */
  'files.copy': { params: { paths: string[] }; result: null }
  /** Moves the file to the Trash. */
  'files.trash': { params: { path: string }; result: null }

  /** Per-plugin JSON storage persisted by the host. */
  'storage.get': { params: { key: string }; result: unknown }
  'storage.set': { params: { key: string; value: unknown }; result: null }

  'system.openUrl': { params: { url: string }; result: null }
  'permissions.status': {
    params: { permission: 'accessibility' | 'calendar' | 'bluetooth' | 'automation' | 'location' }
    result: { granted: boolean }
  }

  'plugins.setEnabled': { params: { id: string; enabled: boolean }; result: null }
  'app.preferences': { params: Record<string, never>; result: AppPreferences }
  'app.setPreferences': { params: Partial<AppPreferences>; result: AppPreferences }
}
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
]

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
  'plugins.changed': { plugins: InstalledPlugin[] }
  /** After `window.endGesture`: the fingers touched the trackpad again, so the next wheel events are a new gesture. */
  'gesture.touch': Record<string, never>
  /** The app menu's Settings…, or `window.openSettings`: the island opens on its settings page. */
  'settings.open': Record<string, never>
}
export type EventName = keyof Events

export type HostEvent = { [E in EventName]: { type: E; payload: Events[E] } }[EventName]
