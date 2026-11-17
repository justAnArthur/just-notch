import { conditionFromCode, Weather, type WeatherNow, type WeatherUnit } from '@justanarthur/modo-ui-notch'
import { Button, Input, List } from '@justanarthur/modo-ui'
import { definePlugin, type PluginContext, SelectRow, signal, SwitchRow, usePlugin, useSheet, useStorage, useTopic, type WeatherState } from '@just-notch/sdk'
import { CloudSun, MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'

const MINUTE = 60_000
/** How far ahead "rain soon" looks. */
const RAIN_AHEAD_MS = 30 * MINUTE
const RAIN_CHANCE = 60
const PRIVACY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices'
const WET = new Set(['drizzle', 'rain', 'heavy-rain', 'sleet', 'snow', 'thunderstorm'])

const UNIT = 'unit'
const RAIN_ALERT = 'rainAlert'

function forecast(state: WeatherState) {
  const current: WeatherNow | undefined = state.current && { ...state.current, condition: conditionFromCode(state.current.code) }
  return {
    location: state.location,
    current,
    hours: state.hours.map((h) => ({ ...h, condition: conditionFromCode(h.code) })),
    days: state.days.map((d) => ({ ...d, condition: conditionFromCode(d.code) })),
    access: state.setting.mode === 'city' ? ('granted' as const) : state.access,
    status: state.status,
  }
}

function useActions() {
  const { call } = usePlugin()
  return {
    onRefresh: () => void call('weather.refresh', {}),
    onRequestAccess: () => void call('weather.requestAccess', {}),
    onOpenSettings: () => void call('system.openUrl', { url: PRIVACY_URL }),
  }
}

function Widget() {
  const state = useTopic('weather')
  const [unit] = useStorage<WeatherUnit>(UNIT, 'celsius')
  const actions = useActions()
  const layout = useSheet()
  if (!state) return <Weather layout={layout} status="loading" unit={unit} />
  return <Weather layout={layout} {...forecast(state)} unit={unit} {...actions} />
}

/** The rain the alert is about: when it starts and how sure. */
const rain = signal<{ startsAt: number; chance: number } | undefined>(undefined)

function RainAlert() {
  const soon = rain.use()
  if (!soon) return null
  return <Weather.Alert condition="rain" startsAt={soon.startsAt} caption={`${soon.chance}% chance`} />
}

function LocationSettings() {
  const { call } = usePlugin()
  const state = useTopic('weather')
  const setting = state?.setting
  const [city, setCity] = useState(setting?.mode === 'city' ? setting.city : '')
  useEffect(() => {
    if (setting?.mode === 'city') setCity(setting.city)
  }, [setting])

  const saveCity = () => {
    const name = city.trim()
    if (name && !(setting?.mode === 'city' && setting.city === name)) void call('weather.setLocation', { mode: 'city', city: name })
  }
  const mode = setting?.mode ?? 'auto'
  const needsAccess = mode === 'auto' && state && state.access !== 'granted'

  return (
    <List.Section title="Location">
      <SelectRow
        label="Forecast for"
        description="Your Mac's location follows you; a city stays put."
        options={[
          { value: 'auto', label: 'Current location' },
          { value: 'city', label: 'A city' },
        ]}
        value={mode}
        onValueChange={(next) => {
          if (next === 'auto') void call('weather.setLocation', { mode: 'auto' })
          else if (city.trim()) saveCity()
          else void call('weather.setLocation', { mode: 'city', city: 'London' })
        }}
      />
      {mode === 'city' && (
        <List.Row label="City">
          <Input
            aria-label="City"
            icon={MapPin}
            value={city}
            placeholder="A city's name"
            className="w-48"
            onValueChange={setCity}
            onBlur={saveCity}
            onKeyDown={(event) => event.key === 'Enter' && saveCity()}
          />
        </List.Row>
      )}
      {needsAccess && (
        <List.Row
          label="Location access"
          description={state.access === 'denied' ? 'Turned off for Just Notch in System Settings.' : 'Not asked for yet.'}
        >
          <Button
            variant="secondary"
            size="compact"
            onClick={() =>
              void (state.access === 'denied'
                ? call('system.openUrl', { url: PRIVACY_URL })
                : call('weather.requestAccess', {}))
            }
          >
            {state.access === 'denied' ? 'Open Settings' : 'Allow'}
          </Button>
        </List.Row>
      )}
    </List.Section>
  )
}

function Settings() {
  const [unit, setUnit] = useStorage<WeatherUnit>(UNIT, 'celsius')
  const [alert, setAlert] = useStorage(RAIN_ALERT, true)
  return (
    <List>
      <LocationSettings />
      <List.Section title="Units">
        <SelectRow
          label="Temperature"
          description="Wind speed follows: km/h with Celsius, mph with Fahrenheit."
          options={[
            { value: 'celsius', label: 'Celsius (°C)' },
            { value: 'fahrenheit', label: 'Fahrenheit (°F)' },
          ]}
          value={unit}
          onValueChange={setUnit}
        />
      </List.Section>
      <List.Section title="Alerts">
        <SwitchRow
          label="Rain soon"
          description="Flashes before rain starts in the next half hour."
          checked={alert}
          onCheckedChange={setAlert}
        />
      </List.Section>
    </List>
  )
}

/** The first wet hour in the next half hour, unless it's wet already. */
function rainSoon(state: WeatherState, now: number) {
  if (state.current && WET.has(conditionFromCode(state.current.code))) return undefined
  const hour = state.hours.find(
    (h) => h.time > now && h.time - now <= RAIN_AHEAD_MS && h.precipitation >= RAIN_CHANCE && WET.has(conditionFromCode(h.code)),
  )
  return hour && { startsAt: hour.time, chance: hour.precipitation }
}

/** Keeps the forecast live only while the rain alert is on: the subscription is what makes the host fetch. */
function activate(ctx: PluginContext) {
  let stopTopic: (() => void) | undefined
  let flashed: number | undefined

  const watch = (on: boolean | undefined) => {
    if ((on ?? true) === !!stopTopic) return
    if (stopTopic) {
      stopTopic()
      stopTopic = undefined
      return
    }
    stopTopic = ctx.subscribe('weather', (state) => {
      const soon = rainSoon(state, Date.now())
      if (!soon || soon.startsAt === flashed) return
      flashed = soon.startsAt
      rain.set(soon)
      ctx.activity.flash({ priority: 'alert', key: 'rain', view: RainAlert, durationMs: 6000 })
    })
  }

  const stopSetting = ctx.storage.subscribe<boolean>(RAIN_ALERT, watch)
  void ctx.storage.get<boolean>(RAIN_ALERT).then(watch)

  return () => {
    stopSetting()
    stopTopic?.()
  }
}

export default definePlugin({
  activate,
  widget: { title: 'Weather', icon: CloudSun, view: Widget },
  settings: Settings,
})
