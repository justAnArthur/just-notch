import type { AppPreferences, Methods, UpdateState } from '@just-notch/bridge-schema'
import { Button } from '@justanarthur/modo-ui'
import { type SettingsPermission, SettingsWindow } from '@justanarthur/modo-ui-notch'
import { useEffect, useState } from 'react'
import { on } from '../host/bus'
import { call } from '../host/client'
import { useHostInfo, useInstalled } from '../host/session'
import { subscribeTopic } from '../host/topics'
import { usePlugins } from '../plugins/loader'
import PluginView from '../plugins/plugin-view'

type SystemPermission = Methods['permissions.status']['params']['permission']
const PRIVACY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_'
const REPO = 'https://github.com/justAnArthur/just-notch'

function Link({ url, children }: { url: string; children: string }) {
  return (
    <Button variant="link" size="compact" onClick={() => void call('runtime', 'system.openUrl', { url })}>
      {children}
    </Button>
  )
}

function updateText(state: UpdateState, checked: boolean) {
  switch (state.kind) {
    case 'idle':
      return checked ? 'Up to date' : undefined
    case 'checking':
      return 'Checking…'
    case 'available':
      return `${state.version} is available`
    case 'downloading':
      return 'Downloading…'
    case 'ready':
      return `Installing ${state.version}…`
    case 'error':
      return state.message
  }
}

/** Sparkle checks here; installing opens its own window, whose steps (and the menu's, and scheduled checks') come back as `updater.state`. */
function Updates() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' })
  const [checked, setChecked] = useState(false)
  useEffect(() => on('updater.state', setState), [])

  const check = async () => {
    setState({ kind: 'checking' })
    setState(await call('runtime', 'updater.check', {}).catch((error) => ({ kind: 'error', message: String(error) }) as const))
    setChecked(true)
  }
  const install = () => void call('runtime', 'updater.install', {}).catch((error) => setState({ kind: 'error', message: String(error) }))
  const text = updateText(state, checked)

  return (
    <span className="flex items-center gap-2">
      {text && <span className="text-muted-foreground">{text}</span>}
      {state.kind === 'available' ? (
        <Button variant="link" size="compact" onClick={install}>
          Install…
        </Button>
      ) : (
        <Button variant="link" size="compact" loading={state.kind === 'checking'} disabled={state.kind === 'downloading' || state.kind === 'ready'} onClick={() => void check()}>
          Check for updates
        </Button>
      )}
    </span>
  )
}

const PERMISSIONS: (Omit<SettingsPermission, 'granted'> & { pane: string; status?: SystemPermission })[] = [
  { id: 'calendar', status: 'calendar', pane: 'Calendars', label: 'Calendar', description: 'Shows your events and a countdown to the next one.' },
  { id: 'location', status: 'location', pane: 'LocationServices', label: 'Location', description: 'Gets the weather where you are.' },
  { id: 'automation', status: 'automation', pane: 'Automation', label: 'Automation', description: 'Controls the apps that play media.' },
  { id: 'files', pane: 'FilesAndFolders', label: 'Downloads and Desktop', description: 'Lists your recent downloads and screenshots.' },
]

function usePreferences() {
  const [preferences, setPreferences] = useState<AppPreferences>()
  useEffect(() => {
    void call('runtime', 'app.preferences', {}).then(setPreferences)
  }, [])
  const change = (next: AppPreferences) => {
    setPreferences(next)
    void call('runtime', 'app.setPreferences', next).then(setPreferences)
  }
  return [preferences, change] as const
}

function useGranted() {
  const [granted, setGranted] = useState<Record<string, boolean>>({})
  useEffect(() => {
    for (const { id, status } of PERMISSIONS)
      if (status) void call('runtime', 'permissions.status', { permission: status }).then((r) => setGranted((g) => ({ ...g, [id]: r.granted })))
    // The folders have no status check that doesn't prompt: the recent files watcher already knows.
    return subscribeTopic('recentFiles', (state) => setGranted((g) => ({ ...g, files: state.access === 'granted' })))
  }, [])
  return granted
}

/**
 * The settings page inside the open island, on its tall snap: the kit's General, Plugins, Permissions and
 * About, and each running plugin's own page. A disabled plugin isn't loaded, so it lists without a page.
 */
export default function Settings() {
  const info = useHostInfo()
  const installed = useInstalled()
  const loaded = usePlugins()
  const [preferences, setPreferences] = usePreferences()
  const granted = useGranted()

  const plugins = installed.map(({ manifest }) => {
    const definition = loaded.find((p) => p.installed.manifest.id === manifest.id)?.definition
    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      icon: definition?.widget?.icon,
      settings: definition?.settings && <PluginView plugin={manifest.id} view={definition.settings} />,
    }
  })

  const about = info
    ? [
        { label: 'Version', value: info.version },
        { label: 'Updates', value: <Updates /> },
        { label: 'Mode', value: info.devMode ? `Development${info.devServerUrl ? ` · ${info.devServerUrl}` : ''}` : 'Release' },
        { label: 'Screen', value: info.geometry.hasNotch ? 'Hardware notch' : 'Virtual notch' },
        { label: 'Website', value: <Link url="https://justanarthur.github.io/just-notch/">justanarthur.github.io/just-notch</Link> },
        { label: 'Source', value: <Link url={REPO}>github.com/justAnArthur/just-notch</Link> },
        { label: 'License', value: <Link url={`${REPO}/blob/main/LICENSE.md`}>FSL-1.1-MIT</Link> },
      ]
    : []

  // `flush` drops the sidebar's own inset; its rows keep 8 px of padding, so pulled out by that much the text
  // lines up with the island's title and tabs (INSET), the row highlights reaching into the margin as in a list.
  return (
    <div className="-mx-2 h-full">
      <SettingsWindow
        name="Just Notch"
        flush
        className="size-full"
        preferences={preferences}
        onPreferencesChange={setPreferences}
        plugins={plugins}
        enabled={Object.fromEntries(installed.map((p) => [p.manifest.id, p.enabled]))}
        onEnabledChange={(next) => {
          for (const { manifest, enabled } of installed)
            if (next[manifest.id] !== enabled) void call('runtime', 'plugins.setEnabled', { id: manifest.id, enabled: next[manifest.id] })
        }}
        permissions={PERMISSIONS.map(({ id, label, description }) => ({ id, label, description, granted: granted[id] }))}
        onOpenPermission={(id) => {
          const pane = PERMISSIONS.find((p) => p.id === id)?.pane
          if (pane) void call('runtime', 'system.openUrl', { url: PRIVACY + pane })
        }}
        about={about}
      />
    </div>
  )
}
