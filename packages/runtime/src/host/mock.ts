import {
  API_VERSION,
  type AppPreferences,
  type BluetoothDevice,
  type Clip,
  type CurrencyRates,
  type FileHit,
  type HostEvent,
  type HostInfo,
  type HostRequest,
  hostAllowed,
  type InstalledPlugin,
  type LibraryCatalog,
  type LibraryEntry,
  type LibraryPhase,
  METHOD_PERMISSION,
  type MediaState,
  type Methods,
  type NetRequest,
  type NetResponse,
  netHostKey,
  netSchemeAllowed,
  PLUGIN_ONLY,
  type PluginManifest,
  type Rect,
  RUNTIME_ONLY,
  type ScreenGeometry,
  satisfies,
  type Topic,
  type Topics,
} from '@just-notch/bridge-schema'
import { performNetFetch } from './net'

/*
 * A host for any browser: the same transport (`window.webkit…postMessage`,
 * `window.__notch.dispatch`) with fake services, so the runtime and plugins
 * run in a normal browser. Installed only when `window.webkit` is absent.
 */

const PANEL = { w: 800, h: 620 }
const NOTCH = { w: 185, h: 32 }

const geometry: ScreenGeometry = {
  panel: PANEL,
  notch: { x: (PANEL.w - NOTCH.w) / 2, y: 0, ...NOTCH },
  hasNotch: true,
  scale: 2,
  screenId: 'mock',
}

const TRACKS = [
  { title: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", durationS: 243 },
  { title: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine', durationS: 330 },
  { title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun', durationS: 258 },
]

function artwork(seed: number) {
  const hue = (seed * 97) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 70% 30%)"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

let track = 0
const hour = 3_600_000
const day = 24 * hour
const midnight = new Date().setHours(0, 0, 0, 0)
const thisHour = new Date().setMinutes(0, 0, 0)
const WEATHER_CODES = [0, 1, 2, 3, 61, 3, 2, 1]
const values: Topics = {
  media: {
    playing: true,
    ...TRACKS[0],
    artworkUrl: artwork(0),
    positionS: 42,
    rate: 1,
    updatedAt: Date.now(),
    sourceApp: 'com.apple.Music',
    shuffle: false,
    repeat: 'off',
    liked: false,
  },
  power: { percent: 76, charging: false, pluggedIn: false, minutesRemaining: 312, lowPowerMode: false, hasBattery: true },
  audio: { volume: 0.5, muted: false, outputDevice: 'MacBook Pro Speakers' },
  display: { brightness: 0.6, keyboardBacklight: 0.4 },
  calendar: {
    access: 'granted',
    upcoming: [
      { id: 'standup', title: 'Design standup', start: Date.now() + 25 * 60_000, end: Date.now() + 40 * 60_000, allDay: false, calendarColor: '#3b82f6', meetingUrl: 'https://meet.example.com/standup' },
      { id: 'review', title: 'Island review', start: Date.now() + 26 * hour, end: Date.now() + 27 * hour, allDay: false, calendarColor: '#f97316', location: 'Studio' },
    ],
  },
  bluetooth: [
    { id: 'kb', name: 'Magic Keyboard', kind: 'keyboard', connected: true, batteryPercent: 64 },
    { id: 'airpods', name: 'AirPods Pro', kind: 'headphones', connected: false },
  ],
  stats: {
    cpu: 0.18,
    memoryUsed: 9.2e9,
    memoryTotal: 16e9,
    memoryPressure: 'normal',
    netInBps: 120_000,
    netOutBps: 24_000,
    diskFree: 212e9,
    diskTotal: 494e9,
    uptimeS: 3 * 86_400 + 4 * 3_600,
  },
  processes: [
    { pid: 812, name: 'Safari', cpu: 0.09, memory: 1.4e9 },
    { pid: 640, name: 'WindowServer', cpu: 0.05, memory: 6.1e8 },
    { pid: 1204, name: 'Xcode', cpu: 0.03, memory: 2.2e9 },
  ],
  weather: {
    access: 'granted',
    status: 'ready',
    setting: { mode: 'auto' },
    location: 'Bratislava',
    current: { time: Date.now(), temperature: 7, apparent: 4, code: 2, isDay: true, wind: 14, humidity: 71, uv: 1 },
    hours: Array.from({ length: 24 }, (_, i) => {
      const time = thisHour + i * hour
      const h = new Date(time).getHours()
      return { time, temperature: 7 - Math.abs(14 - h) / 3, code: WEATHER_CODES[i % WEATHER_CODES.length], isDay: h >= 7 && h < 17, precipitation: i > 3 && i < 7 ? 60 : 10 }
    }),
    days: Array.from({ length: 7 }, (_, i) => ({
      date: midnight + i * day,
      code: WEATHER_CODES[(i * 3) % WEATHER_CODES.length],
      high: 9 - (i % 3),
      low: 2 - (i % 2),
      precipitation: (i * 23) % 80,
      sunrise: midnight + i * day + 7 * hour + 12 * 60_000,
      sunset: midnight + i * day + 16 * hour + 8 * 60_000,
    })),
    updatedAt: Date.now(),
  },
  clipboard: {
    paused: false,
    ignoredApps: ['com.1password.1password'],
    retention: { limit: 1000, days: 30 },
    clips: [
      { id: 'c1', kind: 'link', content: 'https://justanarthur.github.io/modo/notch/', app: 'Safari', copiedAt: Date.now() - 60_000, pinned: false },
      { id: 'c2', kind: 'text', content: 'bun run notch build --cwd plugins/weather', app: 'Terminal', copiedAt: Date.now() - 8 * 60_000, pinned: true },
      { id: 'c3', kind: 'color', content: '#f97316', app: 'Figma', copiedAt: Date.now() - 30 * 60_000, pinned: false },
      { id: 'c4', kind: 'image', content: '1280×720', detail: '412 KB', preview: artwork(4), app: 'Preview', copiedAt: Date.now() - 2 * hour, pinned: false },
    ],
  },
  recentFiles: {
    access: 'granted',
    files: [
      { id: '/Users/me/Downloads/invoice-2026-11.pdf', name: 'invoice-2026-11.pdf', size: 184_000, addedAt: Date.now() - 5 * 60_000, source: 'downloads', from: 'mail.example.com' },
      { id: '/Users/me/Desktop/Screenshot 2026-11-17 at 10.12.04.png', name: 'Screenshot 2026-11-17 at 10.12.04.png', size: 1_240_000, addedAt: Date.now() - 20 * 60_000, source: 'screenshots' },
      { id: '/Users/me/Downloads/modo-kit.zip', name: 'modo-kit.zip', size: 8_400_000, addedAt: Date.now() - 3 * hour, source: 'downloads', from: 'github.com' },
    ],
    downloads: [],
    folders: { downloads: { path: '/Users/me/Downloads', custom: false }, screenshots: { path: '/Users/me/Desktop', custom: false } },
  },
}
const DEFAULT_FOLDERS = values.recentFiles.folders

const subscribed = new Set<Topic>()
/** Topics whose next subscription is answered with `null`, as the real host does before its first sample. */
const nullOnce = new Set<Topic>()
const haptics: Methods['window.haptic']['params']['pattern'][] = []
let plugins: InstalledPlugin[] = []
let pasteboard = ''
/** Registered shortcuts: id → accelerator. */
const shortcuts = new Map<string, string>()
let shortcutIds = 0
/** The version `mock.update()` published, which `updater.check` then finds. */
let update: string | undefined
export const hitRegions: { rects: Rect[]; focusable: boolean } = { rects: [], focusable: false }

function emit(...events: HostEvent[]) {
  queueMicrotask(() => window.__notch?.dispatch(events))
}

/*
 * The real host delivers storage and plugin changes to every web view; tabs of
 * one browser (an island and a settings page) share them over this channel.
 */
const channel = new BroadcastChannel('notch:mock')
channel.onmessage = ({ data }: MessageEvent<HostEvent>) => {
  if (data.type === 'plugins.changed') plugins = data.payload.plugins
  emit(data)
}

function broadcast(event: HostEvent) {
  emit(event)
  channel.postMessage(event)
}

function publish<T extends Topic>(topic: T, value: Topics[T]) {
  values[topic] = value
  if (subscribed.has(topic)) emit({ type: 'topic', payload: { topic, value } as HostEvent['payload'] } as HostEvent)
}

function setClips(clips: Clip[]) {
  publish('clipboard', { ...values.clipboard, clips })
  return null
}

function mediaNow(): MediaState | null {
  const media = values.media
  if (!media?.playing) return media
  const positionS = Math.min(media.durationS, media.positionS + ((Date.now() - media.updatedAt) / 1000) * media.rate)
  return { ...media, positionS, updatedAt: Date.now() }
}

function setTrack(index: number, playing = true) {
  track = (index + TRACKS.length) % TRACKS.length
  const base = values.media ?? { rate: 1, sourceApp: 'com.apple.Music' }
  publish('media', { ...base, ...TRACKS[track], artworkUrl: artwork(track), positionS: 0, playing, updatedAt: Date.now() })
}

setInterval(() => {
  const media = mediaNow()
  if (media?.playing && media.positionS >= media.durationS) setTrack(track + 1)
  if (subscribed.has('stats')) {
    const cpu = Math.min(1, Math.max(0.02, values.stats.cpu + (Math.random() - 0.5) * 0.08))
    publish('stats', { ...values.stats, cpu, netInBps: Math.round(Math.random() * 400_000) })
  }
}, 1000)

const storageKey = (plugin: string, key: string) => `notch:mock:storage:${plugin}:${key}`
const enabledKey = (id: string) => `notch:mock:enabled:${id}`
/** Dev only: the real host keeps secrets in the Keychain. */
const secretKey = (plugin: string, key: string) => `notch:mock:secret:${plugin}:${key}`
const hostsKey = (plugin: string) => `notch:mock:hosts:${plugin}`
const SECRET_KEY = /^[A-Za-z0-9._-]{1,64}$/
/** `plugin host` pairs refused this session. */
const deniedHosts = new Set<string>()

const manifestOf = (plugin: string) => plugins.find((p) => p.manifest.id === plugin)?.manifest
const grantedHosts = (plugin: string): string[] => JSON.parse(localStorage.getItem(hostsKey(plugin)) ?? '[]')

function checkSecretKey(key: string) {
  if (!SECRET_KEY.test(key)) throw `secret keys match ^[A-Za-z0-9._-]{1,64}$ (got ${key})`
}

/**
 * In the Vite dev server `net.fetch` goes through its `/__notch/net` proxy (Node fetch, no CORS), which
 * checks the same hosts; elsewhere (a preview build) the browser fetches, CORS and all.
 */
async function netFetch(request: NetRequest, plugin: string): Promise<NetResponse> {
  if (!import.meta.env.DEV) {
    const allowed = [...(manifestOf(plugin)?.hosts ?? []), ...grantedHosts(plugin)]
    return performNetFetch(request, allowed).catch((error: Error) => Promise.reject(error.message))
  }
  const response = await fetch('/__notch/net', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plugin, grants: grantedHosts(plugin), request }),
  })
  const result = await response.json().catch(() => ({ error: `dev proxy answered ${response.status}` }))
  if (!response.ok) throw String(result.error)
  return result
}
const PREFERENCES_KEY = 'notch:mock:preferences'
const DEFAULT_PREFERENCES: AppPreferences = { launchAtLogin: false, screens: 'notched', launcher: { enabled: true, shortcut: 'Alt+Space', active: true, spotlightConflict: false } }

function preferences(): AppPreferences {
  const raw = localStorage.getItem(PREFERENCES_KEY)
  const saved = raw ? JSON.parse(raw) : {}
  const launcher = { ...DEFAULT_PREFERENCES.launcher, ...saved.launcher }
  const conflict = /^(command|cmd)\+space$/i.test(launcher.shortcut)
  return { ...DEFAULT_PREFERENCES, ...saved, launcher: { ...launcher, active: launcher.enabled, spotlightConflict: conflict } }
}

/** What `apps.index` finds on a typical Mac, enough to rank against. */
const MOCK_APPS: [string, string, string[]?][] = [
  ['com.apple.AppStore', 'App Store'],
  ['com.apple.ActivityMonitor', 'Activity Monitor'],
  ['com.apple.calculator', 'Calculator'],
  ['com.apple.iCal', 'Calendar'],
  ['com.google.Chrome', 'Google Chrome', ['Chrome']],
  ['com.apple.finder', 'Finder'],
  ['com.figma.Desktop', 'Figma'],
  ['com.apple.mail', 'Mail'],
  ['com.apple.Maps', 'Maps'],
  ['com.apple.Music', 'Music'],
  ['com.apple.Notes', 'Notes'],
  ['com.apple.Photos', 'Photos'],
  ['com.apple.Preview', 'Preview'],
  ['com.apple.Safari', 'Safari'],
  ['com.tinyspeck.slackmacgap', 'Slack'],
  ['com.spotify.client', 'Spotify'],
  ['com.apple.systempreferences', 'System Settings', ['System Preferences']],
  ['com.apple.Terminal', 'Terminal'],
  ['com.microsoft.VSCode', 'Visual Studio Code', ['Code']],
  ['com.apple.dt.Xcode', 'Xcode'],
  ['dev.zed.Zed', 'Zed'],
  ['app.zen-browser.zen', 'Zen'],
]
const appPath = (name: string) => `/Applications/${name}.app`

const DAY = 86_400_000
/** What `files.search` finds in a typical home folder: [path, kind, days since last opened, size]. */
const MOCK_FILES: [string, FileHit['kind'], number?, number?][] = [
  ['/Users/me/Documents/Invoices', 'folder', 1],
  ['/Users/me/Documents/Invoices/Invoice 2026-10.pdf', 'pdf', 2, 84_211],
  ['/Users/me/Documents/Taxes 2025.numbers', 'document', 30, 412_804],
  ['/Users/me/Documents/Resume.pages', 'document', 12, 1_203_442],
  ['/Users/me/Downloads/Boarding pass.pdf', 'pdf', 0, 211_090],
  ['/Users/me/Downloads/Screenshot 2026-11-18 at 10.42.13.png', 'image', 1, 1_840_221],
  ['/Users/me/Desktop/Notch launcher sketch.png', 'image', 0, 640_118],
  ['/Users/me/Desktop/Meeting notes.md', 'document', 3, 4_310],
  ['/Users/me/Projects', 'folder', 0],
  ['/Users/me/Projects/notch/README.md', 'document', 5, 9_874],
  ['/Users/me/Pictures/Holiday 2026', 'folder', 60],
  ['/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Recipes/Pancakes.pdf', 'pdf', 90, 120_448],
  ['/Users/me/Music/Demo.m4a', 'other', undefined, 5_402_112],
]

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

function mockFiles(query: string, limit = 20): FileHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const now = Date.now()
  return MOCK_FILES.map(([path, kind, days, size], i): FileHit => ({
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    kind,
    modified: new Date(now - ((days ?? 120) + i) * DAY).toISOString(),
    ...(days !== undefined && { lastUsed: new Date(now - days * DAY - i * 60_000).toISOString() }),
    ...(size !== undefined && { size }),
  }))
    .filter((hit) => words.every((w) => fold(hit.name).includes(w)))
    .sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '') || (b.modified ?? '').localeCompare(a.modified ?? ''))
    .slice(0, limit)
}

/** The ECB's daily reference rates, dated today. */
function mockRates(): CurrencyRates {
  return {
    base: 'EUR',
    date: new Date().toISOString().slice(0, 10),
    rates: {
      USD: 1.0812, JPY: 163.42, BGN: 1.9558, CZK: 25.118, DKK: 7.4742, GBP: 0.83581, HUF: 369.43, PLN: 4.2715, RON: 5.3473,
      SEK: 11.284, CHF: 0.9412, ISK: 147.9, NOK: 10.6475, TRY: 55.4737, AUD: 1.6378, BRL: 6.4765, CAD: 1.5719, CNY: 7.7821,
      HKD: 8.6239, IDR: 17_412.5, ILS: 3.6149, INR: 102.55, KRW: 1460.23, MXN: 20.7946, MYR: 4.5205, NZD: 1.989, PHP: 70.014,
      SGD: 1.4176, THB: 37.218, ZAR: 18.9948,
    },
  }
}

const MOCK_SHORTCUTS = ['Start Pomodoro', 'Translate Clipboard', 'Morning Summary', 'Copy Timestamp', 'Resize Images']

async function loadPlugins(): Promise<InstalledPlugin[]> {
  const response = await fetch('/plugins/index.json').catch(() => null)
  const entries: { manifest: PluginManifest; builtIn: boolean }[] = response?.ok ? await response.json().catch(() => []) : []
  shelf = entries.filter((e) => !e.builtIn).map((e) => e.manifest)
  const installed = libraryInstalled()
  return entries.flatMap(({ manifest, builtIn }) => {
    if (builtIn) return [installedPlugin(manifest, 'builtIn')]
    if (installed && !(manifest.id in installed)) return []
    return [installedPlugin({ ...manifest, version: installed?.[manifest.id] ?? manifest.version }, 'library')]
  })
}

function installedPlugin(manifest: PluginManifest, source: InstalledPlugin['source']): InstalledPlugin {
  const builtIn = source === 'builtIn'
  return {
    manifest,
    baseUrl: new URL(`/plugins/${manifest.id}/`, location.href).href,
    enabled: (localStorage.getItem(enabledKey(manifest.id)) ?? String(manifest.defaultEnabled ?? true)) !== 'false',
    builtIn,
    source,
    ...(!builtIn && !satisfies(API_VERSION, manifest.engines.notch) && { incompatible: incompatibility(manifest.engines.notch) }),
  }
}

/*
 * The library: a catalog built from the dev-served `library/*` manifests (plus one that needs a newer API), and
 * installs that only flip what the plugin list says, with progress events on the real host's steps. Which library
 * plugins are installed is kept in localStorage; until something is installed or uninstalled, all of them are.
 */
const LIBRARY_KEY = 'notch:mock:library'
/** The dev-served `library/*` manifests. */
let shelf: PluginManifest[] = []
/** Ids whose catalog entry is a patch ahead of the served plugin (`mock.libraryUpdate`). */
const ahead = new Set<string>()
let libraryOffline = false
export const libraryTiming = { step: 250 }

const libraryInstalled = (): Record<string, string> | undefined => JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? 'null') ?? undefined
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const bump = (version: string) => version.replace(/(\d+)$/, (patch) => String(Number(patch) + 1))

function catalogEntry(manifest: PluginManifest): LibraryEntry {
  const { id } = manifest
  const version = ahead.has(id) ? bump(manifest.version) : manifest.version
  return {
    id,
    name: manifest.name,
    description: manifest.description,
    version,
    engines: manifest.engines,
    permissions: manifest.permissions,
    hosts: manifest.hosts ?? [],
    author: 'justAnArthur',
    homepage: `https://justanarthur.github.io/just-notch/library/${id}/`,
    source: `https://github.com/justAnArthur/just-notch/tree/main/library/${id}`,
    download: { url: `https://github.com/justAnArthur/just-notch/releases/download/@just-notch/plugin-${id}@${version}/${id}-${version}.notchplugin`, sha256: '0'.repeat(64), size: 28_460 },
    ...(manifest.icon && { icon: new URL(`/plugins/${id}/${manifest.icon}`, location.href).href }),
    screenshots: [],
    releasedAt: new Date(Date.now() - 3 * day).toISOString(),
  }
}

/** A plugin for a newer Just Notch, so the page shows an incompatible one. */
const FUTURE = catalogEntry({
  id: 'linear',
  name: 'Linear',
  version: '2.0.0',
  description: 'Your Linear issues and cycles.',
  entry: 'dist/index.js',
  permissions: ['net', 'secrets'],
  hosts: ['api.linear.app'],
  engines: { notch: '^2.0.0' },
})

function mockCatalog(): LibraryCatalog {
  if (libraryOffline) throw 'The library is offline.'
  return { schema: 1, generatedAt: new Date().toISOString(), plugins: [...shelf.map(catalogEntry), FUTURE] }
}

function libraryProgress(id: string, phase: LibraryPhase, progress?: number, message?: string) {
  emit({ type: 'library.progress', payload: { id, phase, ...(progress !== undefined && { progress }), ...(message && { message }) } })
}

function setLibrary(change: (installed: Record<string, string>) => void) {
  const installed = libraryInstalled() ?? Object.fromEntries(plugins.filter((p) => p.source === 'library').map((p) => [p.manifest.id, p.manifest.version]))
  change(installed)
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(installed))
}

async function libraryInstall(id: string): Promise<InstalledPlugin> {
  const entry = mockCatalog().plugins.find((p) => p.id === id)
  if (!entry) throw `${id} isn't in the library`
  if (!satisfies(API_VERSION, entry.engines.notch)) throw incompatibility(entry.engines.notch)
  const manifest = shelf.find((m) => m.id === id)
  if (!manifest) throw `${id} has nothing to install in the mock`
  const update = plugins.some((p) => p.manifest.id === id)
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    libraryProgress(id, 'downloading', progress)
    await sleep(libraryTiming.step)
  }
  libraryProgress(id, 'verifying')
  await sleep(libraryTiming.step)
  // The real host asks in a native dialog.
  if (!window.confirm(`${update ? 'Update' : 'Install'} “${entry.name}” ${entry.version}?\n\nIt will be able to: ${entry.permissions.join(', ') || 'nothing'}.`)) {
    libraryProgress(id, 'error', undefined, 'cancelled')
    throw 'cancelled'
  }
  libraryProgress(id, 'installing')
  await sleep(libraryTiming.step)
  setLibrary((installed) => {
    installed[id] = entry.version
  })
  if (!update) localStorage.removeItem(enabledKey(id))
  const plugin = installedPlugin({ ...manifest, version: entry.version }, 'library')
  plugins = update ? plugins.map((p) => (p.manifest.id === id ? plugin : p)) : [...plugins, plugin]
  broadcast({ type: 'plugins.changed', payload: { plugins } })
  libraryProgress(id, 'done', 1)
  return plugin
}

function libraryUninstall(id: string) {
  const plugin = plugins.find((p) => p.manifest.id === id)
  if (!plugin) throw `unknown plugin ${id}`
  if (plugin.builtIn) throw `${id} is a built-in plugin: turn it off instead`
  if (!window.confirm(`Uninstall “${plugin.manifest.name}”? It moves to the Trash.`)) throw 'cancelled'
  setLibrary((installed) => {
    delete installed[id]
  })
  plugins = plugins.filter((p) => p.manifest.id !== id)
  broadcast({ type: 'plugins.changed', payload: { plugins } })
  return null
}

/** The host's wording (PluginStore.swift). */
const incompatibility = (range: string) => `Needs plugin API ${range}; this Just Notch has ${API_VERSION}.`

let updaterPreferences = { automaticChecks: true, automaticDownloads: false, lastChecked: Date.now() - 3 * 3_600_000 as number | null }

/** The mock's front window, which `windows.setFrame` moves. */
let mockWindow = { x: 200, y: 120, w: 900, h: 600 }

type Handlers = { [M in keyof Methods]: (params: Methods[M]['params'], plugin: string) => Methods[M]['result'] | Promise<Methods[M]['result']> }

const handlers: Handlers = {
  'host.ready': async (): Promise<HostInfo> => {
    plugins = await loadPlugins()
    return { version: '0.0.0-mock', apiVersion: API_VERSION, devMode: true, devServerUrl: location.origin, plugins, geometry }
  },
  'host.log': ({ level, message }) => {
    if (level === 'error') console.info(`[mock host] ${message}`)
    return null
  },
  'window.setHitRegions': ({ rects }) => {
    hitRegions.rects = rects
    return null
  },
  'window.setFocusable': ({ focusable }) => {
    hitRegions.focusable = focusable
    return null
  },
  'window.endGesture': () => null,
  'window.haptic': ({ pattern }) => {
    haptics.push(pattern)
    return null
  },
  'window.openSettings': () => {
    emit({ type: 'settings.open', payload: {} })
    return null
  },
  'launcher.closed': () => {
    launcherOpen = false
    return null
  },
  subscribe: ({ topic }) => {
    subscribed.add(topic)
    if (nullOnce.delete(topic)) return null
    return topic === 'media' ? mediaNow() : values[topic]
  },
  unsubscribe: ({ topic }) => {
    subscribed.delete(topic)
    return null
  },
  'media.command': (command) => {
    const media = mediaNow()
    if (!media) return null
    if (command.command === 'next') setTrack(track + 1, media.playing)
    else if (command.command === 'previous') setTrack(track - 1, media.playing)
    else if (command.command === 'seek') publish('media', { ...media, positionS: command.positionS })
    else if (command.command === 'shuffle') publish('media', { ...media, shuffle: command.shuffle })
    else if (command.command === 'repeat') publish('media', { ...media, repeat: command.repeat })
    else if (command.command === 'like') publish('media', { ...media, liked: command.liked })
    else publish('media', { ...media, playing: command.command === 'toggle' ? !media.playing : command.command === 'play' })
    return null
  },
  'audio.setVolume': ({ volume }) => {
    publish('audio', { ...values.audio, volume })
    return null
  },
  'display.setBrightness': ({ brightness }) => {
    publish('display', { ...values.display, brightness })
    return null
  },
  'display.setKeyboardBacklight': ({ level }) => {
    publish('display', { ...values.display, keyboardBacklight: level })
    return null
  },
  'hud.setEnabled': ({ enabled }) => ({ enabled }),
  'calendar.requestAccess': () => ({ granted: true }),
  'weather.requestAccess': () => ({ granted: true }),
  'weather.setLocation': (setting) => {
    publish('weather', { ...values.weather, setting, location: setting.mode === 'city' ? setting.city : 'Bratislava' })
    return null
  },
  'weather.refresh': () => {
    publish('weather', { ...values.weather, updatedAt: Date.now() })
    return null
  },
  'clipboard.copy': () => null,
  'clipboard.paste': ({ id, plain }) => {
    actions.push(`paste ${id}${plain ? ' (plain)' : ''}`)
    return { pasted: false }
  },
  'clipboard.delete': ({ id }) => setClips(values.clipboard.clips.filter((c) => c.id !== id)),
  'clipboard.pin': ({ id, pinned }) => setClips(values.clipboard.clips.map((c) => (c.id === id ? { ...c, pinned } : c))),
  'clipboard.clear': ({ since }) => setClips(values.clipboard.clips.filter((c) => c.pinned || (since !== undefined && c.copiedAt < since))),
  'clipboard.setRetention': (retention) => {
    publish('clipboard', { ...values.clipboard, retention })
    return null
  },
  'clipboard.setPaused': ({ paused }) => {
    publish('clipboard', { ...values.clipboard, paused })
    return null
  },
  'clipboard.setIgnoredApps': ({ apps }) => {
    publish('clipboard', { ...values.clipboard, ignoredApps: apps })
    return null
  },
  'apps.list': () =>
    [
      { bundleId: 'com.1password.1password', name: '1Password' },
      { bundleId: 'com.figma.Desktop', name: 'Figma' },
      { bundleId: 'com.apple.Safari', name: 'Safari' },
      { bundleId: 'com.apple.Terminal', name: 'Terminal' },
    ].map((app, i) => ({ ...app, icon: artwork(i + 7) })),
  'apps.index': () => MOCK_APPS.map(([bundleId, name, keywords]) => ({ bundleId, name, path: appPath(name), keywords })),
  'apps.icons': ({ paths }) =>
    Object.fromEntries(paths.map((path) => [path, artwork(MOCK_APPS.findIndex(([, name]) => appPath(name) === path) + 3)])),
  'apps.launch': ({ path }) => {
    launched.push(path)
    return null
  },
  'files.search': ({ query, limit }) => mockFiles(query, limit),
  'rates.currency': mockRates,
  'actions.shortcuts': () => MOCK_SHORTCUTS,
  'actions.runShortcut': ({ name }) => {
    if (!MOCK_SHORTCUTS.includes(name)) throw `no shortcut named ${name}`
    actions.push(`shortcut ${name}`)
    return null
  },
  'actions.system': ({ action }) => {
    actions.push(`system ${action}`)
    return null
  },
  'windows.front': () => ({ app: 'Safari', pid: 1, title: 'Just Notch', frame: { ...mockWindow }, screen: 0, screens: [{ x: 0, y: 33, w: 1512, h: 949 }] }),
  'windows.setFrame': ({ frame }) => {
    mockWindow = frame
    return null
  },
  'recentFiles.clear': ({ source }) => {
    publish('recentFiles', { ...values.recentFiles, files: values.recentFiles.files.filter((f) => f.source !== source) })
    return null
  },
  'recentFiles.chooseFolder': ({ source }) => {
    const folder = { path: `/Users/me/Documents/${source === 'downloads' ? 'Inbox' : 'Captures'}`, custom: true }
    publish('recentFiles', { ...values.recentFiles, folders: { ...values.recentFiles.folders, [source]: folder } })
    return folder
  },
  'recentFiles.resetFolder': ({ source }) => {
    publish('recentFiles', { ...values.recentFiles, folders: { ...values.recentFiles.folders, [source]: DEFAULT_FOLDERS[source] } })
    return null
  },
  'recentFiles.cancelDownload': ({ id }) => {
    publish('recentFiles', { ...values.recentFiles, downloads: values.recentFiles.downloads.filter((d) => d.id !== id) })
    return null
  },
  'files.thumbnail': ({ path }) => ({ url: artwork(path.length) }),
  'files.airdrop': () => null,
  'files.reveal': () => null,
  'files.open': () => null,
  'files.beginDrag': () => null,
  'files.copy': () => null,
  'files.trash': ({ path }) => {
    publish('recentFiles', { ...values.recentFiles, files: values.recentFiles.files.filter((f) => f.id !== path) })
    return null
  },
  'net.fetch': netFetch,
  'net.requestHost': ({ url, reason }, plugin) => {
    const parsed = URL.canParse(url) ? new URL(url) : undefined
    if (!parsed?.hostname) throw 'net.requestHost needs an absolute URL'
    if (!netSchemeAllowed(parsed)) throw 'net.requestHost needs https (http only for local hosts)'
    const host = netHostKey(parsed)
    if (hostAllowed([...(manifestOf(plugin)?.hosts ?? []), ...grantedHosts(plugin)], parsed)) return { granted: true }
    if (deniedHosts.has(`${plugin} ${host}`)) return { granted: false }
    const name = manifestOf(plugin)?.name ?? plugin
    const message = `“${name}” wants to connect to ${host}. It can send anything it stores there, including saved tokens.`
    if (!window.confirm(reason ? `${message}\n\n${reason}` : message)) {
      deniedHosts.add(`${plugin} ${host}`)
      return { granted: false }
    }
    localStorage.setItem(hostsKey(plugin), JSON.stringify([...grantedHosts(plugin), host]))
    return { granted: true }
  },
  'net.hosts': (_, plugin) => ({ manifest: manifestOf(plugin)?.hosts ?? [], granted: grantedHosts(plugin) }),
  'net.revokeHost': ({ plugin, host }) => {
    localStorage.setItem(hostsKey(plugin), JSON.stringify(grantedHosts(plugin).filter((h) => h !== host)))
    return null
  },
  'secrets.get': ({ key }, plugin) => {
    checkSecretKey(key)
    return { value: localStorage.getItem(secretKey(plugin, key)) }
  },
  'secrets.set': ({ key, value }, plugin) => {
    checkSecretKey(key)
    if (new TextEncoder().encode(value).length > 64 * 1024) throw 'a secret is at most 64 KB'
    localStorage.setItem(secretKey(plugin, key), value)
    broadcast({ type: 'secrets.changed', payload: { plugin, key } })
    return null
  },
  'secrets.delete': ({ key }, plugin) => {
    checkSecretKey(key)
    localStorage.removeItem(secretKey(plugin, key))
    broadcast({ type: 'secrets.changed', payload: { plugin, key } })
    return null
  },
  'storage.get': ({ key }, plugin) => {
    const raw = localStorage.getItem(storageKey(plugin, key))
    return raw === null ? null : JSON.parse(raw)
  },
  'storage.set': ({ key, value }, plugin) => {
    localStorage.setItem(storageKey(plugin, key), JSON.stringify(value))
    broadcast({ type: 'storage.changed', payload: { plugin, key, value } })
    return null
  },
  'system.openUrl': ({ url }) => {
    window.open(url, '_blank', 'noopener')
    return null
  },
  'clipboard.writeText': ({ text }) => {
    pasteboard = text
    return null
  },
  'clipboard.readText': () => ({ text: pasteboard }),
  'notifications.send': ({ title, body }) => {
    console.info(`[mock host] notification: ${title}${body ? ` — ${body}` : ''}`)
    return null
  },
  'shortcuts.register': ({ accelerator }) => {
    const id = `shortcut-${++shortcutIds}`
    shortcuts.set(id, accelerator)
    return { id }
  },
  'shortcuts.unregister': ({ id }) => {
    shortcuts.delete(id)
    return null
  },
  'deepLinks.initial': () => ({ url: null }),
  'updater.check': () => (update ? { kind: 'available', version: update } : { kind: 'idle' }),
  'updater.install': () => {
    if (!update) {
      emit({ type: 'updater.state', payload: { kind: 'idle' } })
      return null
    }
    const version = update
    emit({ type: 'updater.state', payload: { kind: 'downloading', progress: 0 } })
    setTimeout(() => emit({ type: 'updater.state', payload: { kind: 'downloading', progress: 1 } }), 600)
    setTimeout(() => emit({ type: 'updater.state', payload: { kind: 'ready', version } }), 1200)
    return null
  },
  'updater.preferences': () => updaterPreferences,
  'updater.setPreferences': (changes) => (updaterPreferences = { ...updaterPreferences, ...changes }),
  'permissions.state': ({ permission }) => ({ state: ({ accessibility: 'stale', notifications: 'notAsked', bluetooth: 'off' } as const)[permission as 'accessibility'] ?? 'allowed' }),
  'permissions.status': ({ permission }) => ({ granted: permission !== 'accessibility' }),
  'plugins.setEnabled': ({ id, enabled }) => {
    localStorage.setItem(enabledKey(id), String(enabled))
    plugins = plugins.map((p) => (p.manifest.id === id ? { ...p, enabled } : p))
    broadcast({ type: 'plugins.changed', payload: { plugins } })
    return null
  },
  'library.catalog': mockCatalog,
  'library.install': ({ id }) => libraryInstall(id),
  'library.uninstall': ({ id }) => libraryUninstall(id),
  'app.preferences': preferences,
  'app.setPreferences': (changes) => {
    const current = preferences()
    const next = { ...current, ...changes, launcher: { ...current.launcher, ...changes.launcher } }
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next))
    return next
  },
}

function authorize({ plugin, method }: HostRequest) {
  if (plugin === 'runtime') {
    if (PLUGIN_ONLY.includes(method)) throw `${method} is for plugins only`
    return
  }
  if (RUNTIME_ONLY.includes(method)) throw `${method} is runtime only`
  const permission = METHOD_PERMISSION[method]
  const manifest = plugins.find((p) => p.manifest.id === plugin)?.manifest
  if (permission && !manifest?.permissions.includes(permission)) throw `${plugin} lacks ${permission} for ${method}`
}

let launcherOpen = false
/** Paths `apps.launch` opened, newest last. */
export const launched: string[] = []
/** Pastes, shortcuts and system actions the launcher asked for, newest last. */
export const actions: string[] = []

/** Triggers for the dev toolbar: what the real host would send. */
export const mock = {
  /** The launcher's shortcut: opens it, or asks it to close. The mock panel doesn't grow, so the pill sits high. */
  launcher() {
    const open = !launcherOpen
    if (open) launcherOpen = true
    emit({ type: 'launcher', payload: { open, top: 220 } })
  },
  hover: (inside: boolean) => emit({ type: 'hover', payload: { inside } }),
  /** Presses the shortcut registered as `accelerator`, else the last one registered. */
  shortcut(accelerator?: string) {
    const id = [...shortcuts].reverse().find(([, a]) => !accelerator || a === accelerator)?.[0]
    if (id) emit({ type: 'shortcut', payload: { id } })
  },
  deepLink: (url: string) => emit({ type: 'deepLink.open', payload: { url } }),
  /** The library lists `id` a patch ahead of the served plugin, so it shows an update. */
  libraryUpdate(id = 'github') {
    ahead.add(id)
  },
  /** `library.catalog` fails until called again. */
  libraryOffline() {
    libraryOffline = !libraryOffline
  },
  /** Publishes a release for `updater.check` to find. */
  update(version = '9.9.9') {
    update = version
  },
  charger() {
    const pluggedIn = !values.power.pluggedIn
    publish('power', { ...values.power, pluggedIn, charging: pluggedIn })
    emit({ type: 'power.plugged', payload: { pluggedIn } })
  },
  volume(step = 0.0625) {
    const volume = Math.round(((values.audio.volume + step) % 1.0625) * 16) / 16
    publish('audio', { ...values.audio, volume, muted: false })
    emit({ type: 'hud', payload: { kind: 'volume', value: volume, muted: false } })
  },
  airpods() {
    const device: BluetoothDevice = { id: 'airpods', name: 'AirPods Pro', kind: 'headphones', connected: true, batteryPercent: 82 }
    publish('bluetooth', values.bluetooth.map((d) => (d.id === device.id ? device : d)))
    emit({ type: 'bluetooth.connected', payload: device })
  },
  fileDrag() {
    emit({ type: 'files.dragging', payload: { active: true, count: 2 } })
    setTimeout(() => {
      emit(
        { type: 'files.dragging', payload: { active: false, count: 0 } },
        { type: 'files.dropped', payload: { paths: ['/Users/me/Desktop/notch.png', '/Users/me/Desktop/spec.pdf'] } },
      )
    }, 1500)
  },
  /** A brightness or keyboard-backlight key: one step of sixteen up, wrapping at full. */
  displayKey(kind: 'brightness' | 'keyboard') {
    const current = kind === 'brightness' ? values.display.brightness : (values.display.keyboardBacklight ?? 0)
    const value = Math.round(((current + 0.0625) % 1.0625) * 16) / 16
    publish('display', kind === 'brightness' ? { ...values.display, brightness: value } : { ...values.display, keyboardBacklight: value })
    emit({ type: 'hud', payload: { kind, value } })
  },
  /** Discharging at `percent`: 19 crosses the low threshold, 9 the critical one. */
  battery(percent: number) {
    publish('power', { ...values.power, percent, charging: false, pluggedIn: false, minutesRemaining: percent * 4 })
  },
  /** An event starting in `minutes`, ahead of the others. */
  eventSoon(minutes = 8) {
    const start = Date.now() + minutes * 60_000
    const event = { id: `soon-${start}`, title: 'Sync with Alex', start, end: start + 30 * 60_000, allDay: false, calendarColor: '#22c55e', meetingUrl: 'https://meet.example.com/sync' }
    publish('calendar', { ...values.calendar, upcoming: [event, ...values.calendar.upcoming].sort((a, b) => a.start - b.start) })
  },
  /** A download under way in Downloads, as Safari writes one. */
  download() {
    const download = { id: '/Users/me/Downloads/notch-1.0.dmg.download', name: 'notch-1.0.dmg', received: 12e6, total: 48e6, rate: 2.4e6, from: 'github.com' }
    publish('recentFiles', { ...values.recentFiles, downloads: [download] })
  },
  togglePlay: () => handlers['media.command']({ command: 'toggle' }, 'runtime'),
  nextTrack: () => setTrack(track + 1),
  stopMedia: () => publish('media', null),
  startMedia: () => setTrack(track),
  /** A screen `w` points wide, as when the panel moves to a smaller display. */
  resize(w = PANEL.w) {
    const panel = { ...PANEL, w }
    emit({ type: 'geometry', payload: { ...geometry, panel, notch: { ...geometry.notch, x: (w - NOTCH.w) / 2 } } })
  },
  /** The next subscription to `topic` is answered with `null`, its first sample arriving later. */
  nullSnapshot: (topic: Topic) => nullOnce.add(topic),
  hitRegions,
  launched,
  haptics,
}

export function installMockHost() {
  window.webkit = {
    messageHandlers: {
      host: {
        async postMessage(request) {
          authorize(request)
          const handler = handlers[request.method] as (params: unknown, plugin: string) => unknown
          return structuredClone(await handler(request.params, request.plugin))
        },
      },
    },
  }
}
