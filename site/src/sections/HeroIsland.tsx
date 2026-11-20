import { Agenda, Clock, ExpandedIsland, Island, type IslandState, NowPlaying, Weather } from '@justanarthur/modo-ui-notch'
import type { AgendaEvent, NowPlayingTrack, WeatherDay, WeatherHour, WeatherNow } from '@justanarthur/modo-ui-notch'
import { CalendarDays, Clock3, CloudSun, Music } from 'lucide-react'
import { useEffect, useState } from 'react'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Stand-in artwork: a gradient tile, so the page loads no album art. */
const ART = <span className="hero-art" />

const TRACK: NowPlayingTrack = {
  title: 'Midnight City',
  artist: 'M83',
  album: "Hurry Up, We're Dreaming",
  artwork: ART,
  tint: 'oklch(0.62 0.17 280)',
  source: 'Music',
  output: 'AirPods Pro',
  outputKind: 'headphones',
  duration: 243,
  position: 71,
}

/** A morning, read from the visitor's clock: a stand-up in 12 minutes, the rest of the day after it. */
function agenda(now: number): AgendaEvent[] {
  const next = Math.ceil((now + 12 * MINUTE) / MINUTE) * MINUTE
  return [
    { id: 'standup', title: 'Design stand-up', start: next, end: next + 15 * MINUTE, meetingUrl: 'https://example.com', color: 'oklch(0.7 0.15 250)' },
    { id: 'review', title: 'Launch review', start: next + 2 * HOUR, end: next + 3 * HOUR, location: 'Studio', color: 'oklch(0.75 0.15 150)' },
    { id: 'gym', title: 'Climbing', start: next + 6 * HOUR, end: next + 8 * HOUR, color: 'oklch(0.75 0.14 60)' },
  ]
}

function forecast(now: number) {
  const hour = new Date(now).setMinutes(0, 0, 0)
  const temps = [18, 19, 19, 17, 16, 15, 14, 14, 13, 13, 12, 12]
  const current: WeatherNow = { time: now - 5 * MINUTE, temperature: 18.4, apparent: 16.2, condition: 'partly-cloudy', isDay: true, wind: 12, humidity: 64, uv: 4 }
  const hours: WeatherHour[] = temps.map((temperature, i) => ({
    time: hour + i * HOUR,
    temperature,
    condition: i >= 3 && i <= 6 ? 'rain' : 'partly-cloudy',
    isDay: true,
    precipitation: i >= 3 && i <= 6 ? 60 : 10,
  }))
  const days: WeatherDay[] = [
    { date: now, condition: 'rain', high: 20, low: 11, precipitation: 60 },
    { date: now + 24 * HOUR, condition: 'clear', high: 21, low: 10, precipitation: 0 },
  ]
  return { location: 'Bratislava', current, hours, days, now }
}

/**
 * The real island from modo-ui-notch, on the page's menu bar: compact with what plays, open on hover or a
 * click, four plugins in its tabs. It opens once on its own, so a visitor who never hovers still sees it.
 */
export default function HeroIsland() {
  const [state, setState] = useState<IslandState>('compact')
  const [now] = useState(Date.now)

  useEffect(() => {
    const timer = setTimeout(() => setState((s) => (s === 'compact' ? 'expanded' : s)), 900)
    return () => clearTimeout(timer)
  }, [])

  const tabs = [
    { value: 'now-playing', label: 'Now Playing', icon: Music, content: <NowPlaying track={TRACK} defaultShuffle={false} defaultLiked /> },
    { value: 'calendar', label: 'Calendar', icon: CalendarDays, content: <Agenda events={agenda(now)} now={now} /> },
    { value: 'weather', label: 'Weather', icon: CloudSun, content: <Weather {...forecast(now)} /> },
    { value: 'clock', label: 'Clock', icon: Clock3, content: <Clock zones={[{ city: 'New York', timeZone: 'America/New_York' }, { city: 'Tokyo', timeZone: 'Asia/Tokyo' }]} /> },
  ]

  return (
    <Island
      state={state}
      onStateChange={setState}
      collapsedState="compact"
      expandOnHover
      notchHeight={38}
      panelWidth={640}
      panelHeight={240}
      leading={<NowPlaying.Leading track={TRACK} />}
      trailing={<NowPlaying.Trailing track={TRACK} playing />}
      expanded={<ExpandedIsland tabs={tabs} defaultValue="now-playing" />}
      label="Open the island"
    />
  )
}
