import { NowPlaying, type NowPlayingOutput, type NowPlayingTrack } from '@justanarthur/modo-ui-notch'
import { List } from '@justanarthur/modo-ui'
import { definePlugin, type MediaState, type PluginContext, SwitchRow, useMediaPosition, usePlugin, useStorage, useTopic } from '@just-notch/sdk'
import { Music } from 'lucide-react'

const PAUSED_MS = 30_000
const ANNOUNCE = 'announceTracks'

const APPS: Record<string, string> = {
  'com.apple.Music': 'Music',
  'com.apple.podcasts': 'Podcasts',
  'com.apple.TV': 'TV',
  'com.apple.Safari': 'Safari',
  'com.apple.QuickTimePlayerX': 'QuickTime Player',
  'com.spotify.client': 'Spotify',
  'com.google.Chrome': 'Chrome',
  'com.brave.Browser': 'Brave',
  'com.microsoft.edgemac': 'Edge',
  'com.operasoftware.Opera': 'Opera',
  'com.vivaldi.Vivaldi': 'Vivaldi',
  'company.thebrowser.Browser': 'Arc',
  'app.zen-browser.zen': 'Zen',
  'org.mozilla.firefox': 'Firefox',
  'org.videolan.vlc': 'VLC',
  'com.tidal.desktop': 'TIDAL',
}
// Segments that name the vendor's domain or the app's kind, not the app.
const GENERIC = new Set(['app', 'com', 'org', 'net', 'io', 'co', 'desktop', 'client', 'mac', 'macos', 'browser', 'player'])

function appName(bundleId?: string) {
  if (!bundleId) return undefined
  if (APPS[bundleId]) return APPS[bundleId]
  const word = bundleId.split('.').reverse().find((w) => !GENERIC.has(w.toLowerCase())) ?? bundleId
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function outputKind(device: string): NowPlayingOutput {
  if (/airpods|headphones|beats|buds/i.test(device)) return 'headphones'
  if (/airplay|apple tv|homepod/i.test(device)) return 'airplay'
  if (/macbook|built-in|internal/i.test(device)) return 'built-in'
  return 'speaker'
}

const trackId = (m: MediaState) => [m.title, m.artist, m.album].join('|')

/** The host's media state as the kit's track; the host keeps artwork across a track's updates, so none means none. */
function toTrack(media: MediaState, position: number, output?: string): NowPlayingTrack {
  return {
    id: trackId(media),
    title: media.title || 'Unknown title',
    artist: media.artist || undefined,
    album: media.album || undefined,
    artwork: media.artworkUrl ?? null,
    source: appName(media.sourceApp),
    output,
    outputKind: output ? outputKind(output) : undefined,
    duration: media.durationS,
    position,
  }
}

function useTrack() {
  const media = useTopic('media')
  const output = useTopic('audio')?.outputDevice
  const position = useMediaPosition(media)
  return { media, track: media ? toTrack(media, position, output) : null }
}

function Player() {
  const { call } = usePlugin()
  const { media, track } = useTrack()
  const command = (command: 'play' | 'pause' | 'next' | 'previous') => void call('media.command', { command })
  return (
    <NowPlaying
      track={track}
      playing={media?.playing ?? false}
      onPlayingChange={(playing) => command(playing ? 'play' : 'pause')}
      onPrevious={() => command('previous')}
      onNext={() => command('next')}
      onSeek={(positionS) => void call('media.command', { command: 'seek', positionS })}
    />
  )
}

function Leading() {
  return <NowPlaying.Leading track={useTrack().track} />
}

function Trailing() {
  const { media, track } = useTrack()
  return <NowPlaying.Trailing track={track} playing={media?.playing ?? false} />
}

function Minimal() {
  return <NowPlaying.Minimal track={useTrack().track} />
}

function Flash() {
  const { media, track } = useTrack()
  return track ? <NowPlaying.Flash track={track} playing={media?.playing ?? false} /> : null
}

function Settings() {
  const [announce, setAnnounce] = useStorage(ANNOUNCE, true)
  return (
    <List>
      <List.Section title="Announcements">
        <SwitchRow
          label="Announce track changes"
          description="Shows the new track below the notch for a moment while the island is collapsed."
          checked={announce}
          onCheckedChange={setAnnounce}
        />
      </List.Section>
    </List>
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
    ctx.activity.show({ priority: 'media', compact: { leading: Leading, trailing: Trailing }, minimal: Minimal, expanded: Player })
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
    if ((await ctx.storage.get<boolean>(ANNOUNCE)) === false) return
    ctx.activity.flash({ priority: 'alert', key: 'track', view: Flash, durationMs: 2500 })
  }

  const stop = ctx.subscribe('media', (media) => {
    if (!media) {
      lastTrack = undefined
      return hide()
    }
    const track = trackId(media)
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
  widget: { title: 'Now Playing', icon: Music, view: Player },
  settings: Settings,
})
