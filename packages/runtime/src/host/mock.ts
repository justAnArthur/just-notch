import {
  type AppPreferences,
  type BluetoothDevice,
  type HostEvent,
  type HostInfo,
  type HostRequest,
  type InstalledPlugin,
  METHOD_PERMISSION,
  type MediaState,
  type Methods,
  type PluginManifest,
  type Rect,
  RUNTIME_ONLY,
  type ScreenGeometry,
  type Topic,
  type Topics,
} from '@just-notch/bridge-schema'

/*
 * A host for any browser: the same transport (`window.webkit…postMessage`,
 * `window.__notch.dispatch`) with fake services, so the runtime and plugins
 * run in a normal browser. Installed only when `window.webkit` is absent.
 */

const PANEL = { w: 720, h: 320 }
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
const values: Topics = {
  media: {
    playing: true,
    ...TRACKS[0],
    artworkUrl: artwork(0),
    positionS: 42,
    rate: 1,
    updatedAt: Date.now(),
    sourceApp: 'com.apple.Music',
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
  stats: { cpu: 0.18, memoryUsed: 9.2e9, memoryTotal: 16e9, netInBps: 120_000, netOutBps: 24_000 },
}

const subscribed = new Set<Topic>()
/** Topics whose next subscription is answered with `null`, as the real host does before its first sample. */
const nullOnce = new Set<Topic>()
const haptics: Methods['window.haptic']['params']['pattern'][] = []
let plugins: InstalledPlugin[] = []
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
const PREFERENCES_KEY = 'notch:mock:preferences'
const DEFAULT_PREFERENCES: AppPreferences = { launchAtLogin: false, screens: 'notched' }

function preferences(): AppPreferences {
  const raw = localStorage.getItem(PREFERENCES_KEY)
  return { ...DEFAULT_PREFERENCES, ...(raw ? JSON.parse(raw) : {}) }
}

async function loadPlugins(): Promise<InstalledPlugin[]> {
  const response = await fetch('/plugins/index.json').catch(() => null)
  const manifests: PluginManifest[] = response?.ok ? await response.json().catch(() => []) : []
  return manifests.map((manifest) => ({
    manifest,
    baseUrl: new URL(`/plugins/${manifest.id}/`, location.href).href,
    enabled: localStorage.getItem(enabledKey(manifest.id)) !== 'false',
    builtIn: true,
  }))
}

type Handlers = { [M in keyof Methods]: (params: Methods[M]['params'], plugin: string) => Methods[M]['result'] | Promise<Methods[M]['result']> }

const handlers: Handlers = {
  'host.ready': async (): Promise<HostInfo> => {
    plugins = await loadPlugins()
    return { version: '0.0.0-mock', devMode: true, devServerUrl: location.origin, plugins, geometry }
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
  'window.haptic': ({ pattern }) => {
    haptics.push(pattern)
    return null
  },
  'window.openSettings': () => {
    window.open('/settings.html', 'notch-settings')
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
  'files.thumbnail': ({ path }) => ({ url: artwork(path.length) }),
  'files.airdrop': () => null,
  'files.reveal': () => null,
  'files.open': () => null,
  'files.beginDrag': () => null,
  'storage.get': ({ key }, plugin) => {
    const raw = localStorage.getItem(storageKey(plugin, key))
    return raw === null ? undefined : JSON.parse(raw)
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
  'permissions.status': ({ permission }) => ({ granted: permission !== 'accessibility' }),
  'plugins.setEnabled': ({ id, enabled }) => {
    localStorage.setItem(enabledKey(id), String(enabled))
    plugins = plugins.map((p) => (p.manifest.id === id ? { ...p, enabled } : p))
    broadcast({ type: 'plugins.changed', payload: { plugins } })
    return null
  },
  'app.preferences': preferences,
  'app.setPreferences': (changes) => {
    const next = { ...preferences(), ...changes }
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next))
    return next
  },
}

function authorize({ plugin, method }: HostRequest) {
  if (plugin === 'runtime') return
  if (RUNTIME_ONLY.includes(method)) throw `${method} is runtime only`
  const permission = METHOD_PERMISSION[method]
  const manifest = plugins.find((p) => p.manifest.id === plugin)?.manifest
  if (permission && !manifest?.permissions.includes(permission)) throw `${plugin} lacks ${permission} for ${method}`
}

/** Triggers for the dev toolbar: what the real host would send. */
export const mock = {
  hover: (inside: boolean) => emit({ type: 'hover', payload: { inside } }),
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
  togglePlay: () => handlers['media.command']({ command: 'toggle' }, 'runtime'),
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
