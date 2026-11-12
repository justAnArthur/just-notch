import { Button, spring } from '@justanarthur/modo-ui'
import { definePlugin, type BluetoothDevice, useMediaPosition, usePlugin, useTopic } from '@just-notch/sdk'
import { Headphones, Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

function Artwork({ className }: { className: string }) {
  const media = useTopic('media')
  if (!media?.artworkUrl) return <div className={`${className} bg-surface-3`} />
  return <img alt="" src={media.artworkUrl} className={`${className} object-cover`} />
}

function Bars() {
  const playing = useTopic('media')?.playing ?? false
  const [levels, setLevels] = useState([0.4, 0.8, 0.6, 0.9])
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setLevels((l) => l.map(() => 0.25 + Math.random() * 0.75)), 260)
    return () => clearInterval(timer)
  }, [playing])
  return (
    <div className="flex h-3.5 items-center gap-0.5">
      {levels.map((level, i) => (
        <motion.span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed bars
          key={i}
          className="h-full w-0.75 origin-center rounded-full bg-foreground"
          animate={{ scaleY: playing ? level : 0.2 }}
          transition={spring.moderate}
        />
      ))}
    </div>
  )
}

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function NowPlaying() {
  const media = useTopic('media')
  const position = useMediaPosition(media)
  const { call } = usePlugin()
  if (!media) return null
  const command = (c: 'previous' | 'toggle' | 'next') => () => void call('media.command', { command: c })
  return (
    <div className="flex size-full items-center gap-5">
      <Artwork className="size-24 shrink-0 rounded-xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-subtitle weight-semibold text-foreground">{media.title}</span>
          <span className="truncate text-caption text-muted-foreground">
            {media.artist} — {media.album}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-8 text-micro text-muted-foreground tabular-nums">{time(position)}</span>
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-hover">
            <motion.div
              className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-foreground"
              animate={{ scaleX: media.durationS ? position / media.durationS : 0 }}
              transition={spring.moderate}
            />
          </div>
          <span className="w-8 text-right text-micro text-muted-foreground tabular-nums">{time(media.durationS)}</span>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Previous" onClick={command('previous')}>
            <SkipBack size={16} strokeWidth={1.5} />
          </Button>
          <Button variant="ghost" size="icon" aria-label={media.playing ? 'Pause' : 'Play'} onClick={command('toggle')}>
            {media.playing ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next" onClick={command('next')}>
            <SkipForward size={16} strokeWidth={1.5} />
          </Button>
        </div>
      </div>
    </div>
  )
}

function VolumeHud() {
  const audio = useTopic('audio')
  const volume = audio?.muted ? 0 : (audio?.volume ?? 0)
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  return (
    <div className="flex items-center gap-3">
      <Icon size={16} strokeWidth={1.5} className="shrink-0 text-foreground" />
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
        <motion.div
          className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-foreground"
          initial={false}
          animate={{ scaleX: volume }}
          transition={spring.moderate}
        />
      </div>
      <span className="w-8 text-right text-caption text-muted-foreground tabular-nums">{Math.round(volume * 100)}</span>
    </div>
  )
}

function Charging() {
  const power = useTopic('power')
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-body text-foreground">
        <Zap size={16} strokeWidth={1.5} className="text-status-success" />
        Charging
      </span>
      <span className="text-body weight-semibold text-status-success tabular-nums">{power?.percent ?? '–'}%</span>
    </div>
  )
}

let connected: BluetoothDevice | undefined

function Connected() {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2 text-body text-foreground">
        <Headphones size={16} strokeWidth={1.5} className="shrink-0" />
        <span className="truncate">{connected?.name}</span>
      </span>
      {connected?.batteryPercent !== undefined && (
        <span className="text-body text-muted-foreground tabular-nums">{connected.batteryPercent}%</span>
      )}
    </div>
  )
}

/** The widget: proves hooks, state and the shared modo-ui Button work from a plugin. */
function Hello() {
  const media = useTopic('media')
  const [count, setCount] = useState(0)
  return (
    <div id="hello-widget" className="flex size-full flex-col items-start justify-center gap-3">
      <div className="flex flex-col">
        <span className="text-subtitle weight-semibold text-foreground">Hello from a plugin</span>
        <span className="text-caption text-muted-foreground">Listening to {media?.title ?? 'nothing'}</span>
      </div>
      <Button variant="secondary" size="compact" onClick={() => setCount((c) => c + 1)}>
        {count === 0 ? 'Say hi' : `Said hi ${count}×`}
      </Button>
    </div>
  )
}

export default definePlugin({
  activate(ctx) {
    let shown = false
    const stopMedia = ctx.subscribe('media', (media) => {
      if (Boolean(media) === shown) return
      shown = Boolean(media)
      if (!media) return ctx.activity.hide()
      ctx.activity.show({
        priority: 'media',
        compact: { leading: () => <Artwork className="size-5.5 rounded-md" />, trailing: Bars },
        expanded: NowPlaying,
      })
    })
    const stopHud = ctx.on('hud', ({ kind }) => {
      if (kind === 'volume') ctx.activity.flash({ priority: 'hud', key: 'volume', view: VolumeHud, durationMs: 1600 })
    })
    const stopPower = ctx.on('power.plugged', ({ pluggedIn }) => {
      if (pluggedIn) ctx.activity.flash({ priority: 'alert', view: Charging })
    })
    const stopBluetooth = ctx.on('bluetooth.connected', (device) => {
      connected = device
      ctx.activity.flash({ priority: 'alert', view: Connected })
    })
    return () => {
      stopMedia()
      stopHud()
      stopPower()
      stopBluetooth()
    }
  },
  widget: { title: 'Greeting', view: Hello },
})
