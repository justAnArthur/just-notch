import { Button, Slider, Switch, SwitchGroup, spring } from '@justanarthur/modo-ui'
import { definePlugin, type MediaState, type PluginContext, useMediaPosition, usePlugin, useStorage, useTopic } from '@just-notch/sdk'
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { motion, useReducedMotion, useReducedMotionConfig } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

const PAUSED_MS = 30_000
const ANNOUNCE = 'announceTracks'
const BARS = { rest: [0.2, 0.2, 0.2, 0.2], still: [0.5, 0.85, 0.65, 0.4] }
// Each bar loops its own levels at its own pace, so together they read as random. A `transform` keyframe loop runs
// as a native compositor animation: no timer, no JS per frame while music plays.
const LOOPS = [
  { levels: [0.35, 1, 0.5, 0.8, 0.35], beats: 5 },
  { levels: [0.7, 0.4, 0.95, 0.55, 0.7], beats: 4 },
  { levels: [0.5, 0.9, 0.3, 1, 0.5], beats: 6 },
  { levels: [0.4, 0.75, 0.6, 0.3, 0.4], beats: 4.5 },
]

const APPS: Record<string, string> = {
  'com.apple.Music': 'Music',
  'com.apple.podcasts': 'Podcasts',
  'com.apple.TV': 'TV',
  'com.apple.Safari': 'Safari',
  'com.spotify.client': 'Spotify',
  'com.google.Chrome': 'Chrome',
  'company.thebrowser.Browser': 'Arc',
  'org.mozilla.firefox': 'Firefox',
}

function appName(bundleId?: string) {
  if (!bundleId) return undefined
  const last = bundleId.split('.').pop() ?? bundleId
  return APPS[bundleId] ?? last.charAt(0).toUpperCase() + last.slice(1)
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function useReduce() {
  return (useReducedMotion() ?? false) || (useReducedMotionConfig() ?? false)
}

// Artwork is data: the bars take its average hue, lifted so it reads on black.
const tints = new Map<string, string | undefined>()

function averageHue(img: HTMLImageElement) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 8
    const g = canvas.getContext('2d')
    if (!g) return undefined
    g.drawImage(img, 0, 0, 8, 8)
    const px = g.getImageData(0, 0, 8, 8).data
    let [r, gr, b] = [0, 0, 0]
    for (let i = 0; i < px.length; i += 4) [r, gr, b] = [r + px[i], gr + px[i + 1], b + px[i + 2]]
    const n = px.length / 4
    ;[r, gr, b] = [r / n / 255, gr / n / 255, b / n / 255]
    const max = Math.max(r, gr, b)
    const d = max - Math.min(r, gr, b)
    if (d < 0.08) return undefined
    const h = max === r ? ((gr - b) / d) % 6 : max === gr ? (b - r) / d + 2 : (r - gr) / d + 4
    return `hsl(${Math.round(h * 60 + 360) % 360} 70% 68%)`
  } catch {
    return undefined
  }
}

function useTint(url?: string) {
  const [tint, setTint] = useState(() => (url ? tints.get(url) : undefined))
  useEffect(() => {
    if (!url) return setTint(undefined)
    if (tints.has(url)) return setTint(tints.get(url))
    let live = true
    const img = new Image()
    img.onload = () => {
      tints.set(url, averageHue(img))
      if (live) setTint(tints.get(url))
    }
    img.src = url
    return () => {
      live = false
    }
  }, [url])
  return tint
}

function Artwork({ className }: { className: string }) {
  const url = useTopic('media')?.artworkUrl
  if (!url)
    return (
      <div className={`${className} flex shrink-0 items-center justify-center bg-surface-3 text-muted-foreground`}>
        <Music size={14} strokeWidth={1.5} />
      </div>
    )
  return (
    <motion.img
      key={url}
      alt=""
      src={url}
      draggable={false}
      className={`${className} shrink-0 object-cover`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={spring.moderate}
    />
  )
}

function Bars() {
  const media = useTopic('media')
  const tint = useTint(media?.artworkUrl)
  const reduced = useReduce()
  const playing = media?.playing ?? false
  const live = playing && !reduced
  const still = playing ? BARS.still : BARS.rest

  return (
    <div className="flex h-3.5 shrink-0 items-center gap-0.5" aria-hidden>
      {LOOPS.map((loop, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed bars
        <Bar key={i} loop={loop} live={live} level={still[i]} tint={tint} />
      ))}
    </div>
  )
}

interface BarProps {
  loop: (typeof LOOPS)[number]
  live: boolean
  level: number
  tint?: string
}

/** Playing, the bar loops on the Web Animations API, which WebKit runs on the compositor: no JS per frame. */
function Bar({ loop, live, level, tint }: BarProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const bar = ref.current
    if (!live || !bar) return
    const animation = bar.animate(
      loop.levels.map((l) => ({ transform: `scaleY(${l})` })),
      { duration: spring.slow.duration * loop.beats * 1000, easing: 'ease-in-out', iterations: Number.POSITIVE_INFINITY },
    )
    return () => animation.cancel()
  }, [live, loop])

  return (
    <motion.span
      ref={ref}
      className={`h-full w-0.75 rounded-full ${tint ? '' : 'bg-foreground'}`}
      style={tint ? { backgroundColor: tint } : undefined}
      initial={false}
      animate={{ scaleY: level }}
      transition={spring.moderate}
    />
  )
}

function Scrubber({ media }: { media: MediaState }) {
  const { call } = usePlugin()
  const position = useMediaPosition(media)
  // `at` is unset while dragging; after a commit the value holds until the host answers with a new state.
  const [held, setHeld] = useState<{ s: number; at?: number }>()

  useEffect(() => {
    setHeld((h) => (h?.at !== undefined && h.at !== media.updatedAt ? undefined : h))
  }, [media.updatedAt])

  const commit = () => {
    if (!held || held.at !== undefined) return
    setHeld({ s: held.s, at: media.updatedAt })
    call('media.command', { command: 'seek', positionS: held.s }).catch(() => setHeld(undefined))
  }

  const value = held?.s ?? position
  return (
    <div className="flex items-center gap-3" onPointerUp={commit} onKeyUp={commit}>
      <span className="w-8 shrink-0 text-micro text-muted-foreground tabular-nums">{clock(value)}</span>
      <Slider
        className="mb-0 min-w-0 flex-1"
        size="compact"
        label="Position"
        showValue={false}
        formatValue={clock}
        min={0}
        max={Math.max(1, media.durationS)}
        step={1}
        value={value}
        onChange={(v) => setHeld({ s: v as number })}
      />
      <span className="w-8 shrink-0 text-right text-micro text-muted-foreground tabular-nums">
        -{clock(Math.max(0, media.durationS - value))}
      </span>
    </div>
  )
}

const GLYPH = { size: 18, strokeWidth: 1.5, fill: 'currentColor', strokeLinejoin: 'round' } as const

function Controls({ media }: { media: MediaState }) {
  const { call } = usePlugin()
  const command = (c: 'previous' | 'toggle' | 'next') => () => void call('media.command', { command: c })
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" aria-label="Previous" onClick={command('previous')}>
        <SkipBack {...GLYPH} size={16} />
      </Button>
      <Button variant="ghost" size="icon" className="text-foreground" aria-label={media.playing ? 'Pause' : 'Play'} onClick={command('toggle')}>
        {media.playing ? <Pause {...GLYPH} /> : <Play {...GLYPH} />}
      </Button>
      <Button variant="ghost" size="icon" aria-label="Next" onClick={command('next')}>
        <SkipForward {...GLYPH} size={16} />
      </Button>
    </div>
  )
}

function Player({ media }: { media: MediaState }) {
  return (
    <div className="flex size-full items-center gap-5">
      <Artwork className="size-30 rounded-2xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-subtitle weight-semibold text-foreground">{media.title}</span>
            <span className="truncate text-caption text-muted-foreground">{media.artist}</span>
          </div>
          <Bars />
        </div>
        <Scrubber media={media} />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className="truncate text-caption text-muted-foreground">{appName(media.sourceApp)}</span>
          <Controls media={media} />
          <span />
        </div>
      </div>
    </div>
  )
}

function Expanded() {
  const media = useTopic('media')
  return media ? <Player media={media} /> : null
}

function Widget() {
  const media = useTopic('media')
  if (media) return <Player media={media} />
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-surface-3 text-muted-foreground">
        <Music size={16} strokeWidth={1.5} />
      </div>
      <div className="flex flex-col">
        <span className="text-body weight-medium text-foreground">Nothing playing</span>
        <span className="text-caption text-muted-foreground">Play something in Music, Spotify or a browser.</span>
      </div>
    </div>
  )
}

function TrackFlash() {
  const media = useTopic('media')
  if (!media) return null
  return (
    <div className="flex items-center gap-3">
      <Artwork className="size-8 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body weight-semibold text-foreground">{media.title}</span>
        <span className="truncate text-caption text-muted-foreground">{media.artist}</span>
      </div>
      <Bars />
    </div>
  )
}

function Settings() {
  const [announce, setAnnounce] = useStorage(ANNOUNCE, false)
  return (
    <SwitchGroup>
      <Switch
        label="Announce track changes"
        description="Shows the new track for a moment while the island is collapsed."
        checked={announce}
        onCheckedChange={setAnnounce}
      />
    </SwitchGroup>
  )
}

function activate(ctx: PluginContext) {
  let shown = false
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let lastTrack: string | undefined

  const show = () => {
    clearTimeout(hideTimer)
    hideTimer = undefined
    if (shown) return
    shown = true
    ctx.activity.show({
      priority: 'media',
      compact: { leading: () => <Artwork className="size-5.5 rounded-md" />, trailing: Bars },
      minimal: () => <Artwork className="size-6 rounded-full" />,
      expanded: Expanded,
    })
  }

  const hide = () => {
    clearTimeout(hideTimer)
    hideTimer = undefined
    if (!shown) return
    shown = false
    ctx.activity.hide()
  }

  const announce = async () => {
    if (ctx.island.get() === 'expanded') return
    if (!(await ctx.storage.get<boolean>(ANNOUNCE))) return
    ctx.activity.flash({ priority: 'alert', key: 'track', view: TrackFlash, durationMs: 2500 })
  }

  const stop = ctx.subscribe('media', (media) => {
    if (!media) {
      lastTrack = undefined
      return hide()
    }
    const track = [media.title, media.artist, media.album].join('\u0000')
    const changed = lastTrack !== undefined && track !== lastTrack
    lastTrack = track
    if (media.playing) show()
    else if (shown && !hideTimer) hideTimer = setTimeout(hide, PAUSED_MS)
    if (changed && media.playing) void announce()
  })

  return () => {
    stop()
    hide()
  }
}

export default definePlugin({
  activate,
  widget: { title: 'Now Playing', icon: Music, view: Widget },
  settings: Settings,
})
