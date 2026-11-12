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
  percent: number
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
  /** Events from now until the end of tomorrow, sorted by start. */
  upcoming: CalendarEvent[]
}

export interface BluetoothDevice {
  id: string
  name: string
  kind: 'headphones' | 'keyboard' | 'mouse' | 'speaker' | 'other'
  connected: boolean
  batteryPercent?: number
}

export interface StatsState {
  cpu: number // 0…1
  memoryUsed: number // bytes
  memoryTotal: number
  netInBps: number
  netOutBps: number
}

export interface Topics {
  media: MediaState | null
  power: PowerState
  audio: AudioState
  calendar: CalendarState
  bluetooth: BluetoothDevice[]
  stats: StatsState
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
  'window.openSettings': { params: Record<string, never>; result: null }

  subscribe: { params: { topic: Topic }; result: Topics[Topic] }
  unsubscribe: { params: { topic: Topic }; result: null }

  'media.command': { params: MediaCommand; result: null }
  'audio.setVolume': { params: { volume: number }; result: null }
  'display.setBrightness': { params: { brightness: number }; result: null }
  /** While enabled the host intercepts volume / brightness keys and sends `hud` events instead of the system HUD. Needs Accessibility. */
  'hud.setEnabled': { params: { enabled: boolean }; result: { enabled: boolean } }

  'calendar.requestAccess': { params: Record<string, never>; result: { granted: boolean } }

  /** QuickLook thumbnail as a `data:` URL. */
  'files.thumbnail': { params: { path: string; size: number }; result: { url: string } }
  'files.airdrop': { params: { paths: string[] }; result: null }
  'files.reveal': { params: { path: string }; result: null }
  'files.open': { params: { path: string }; result: null }
  /** Call from a `pointerdown`: the host starts a native drag of these files out of the panel. */
  'files.beginDrag': { params: { paths: string[] }; result: null }

  /** Per-plugin JSON storage persisted by the host. */
  'storage.get': { params: { key: string }; result: unknown }
  'storage.set': { params: { key: string; value: unknown }; result: null }

  'system.openUrl': { params: { url: string }; result: null }
  'permissions.status': {
    params: { permission: 'accessibility' | 'calendar' | 'bluetooth' | 'automation' }
    result: { granted: boolean }
  }

  'plugins.setEnabled': { params: { id: string; enabled: boolean }; result: null }
}
export type Method = keyof Methods

/** A JS → Swift message. `plugin` is the caller's id, or `runtime` for the runtime itself. */
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
  'hud.setEnabled': 'hud',
  'calendar.requestAccess': 'calendar.read',
  'files.thumbnail': 'files',
  'files.airdrop': 'files',
  'files.reveal': 'files',
  'files.open': 'files',
  'files.beginDrag': 'files',
}

/** Methods only the runtime (`plugin: 'runtime'`) may call. */
export const RUNTIME_ONLY: Method[] = ['host.ready', 'window.setHitRegions', 'window.setFocusable', 'plugins.setEnabled']

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
  'plugins.changed': { plugins: InstalledPlugin[] }
}
export type EventName = keyof Events

export type HostEvent = { [E in EventName]: { type: E; payload: Events[E] } }[EventName]
