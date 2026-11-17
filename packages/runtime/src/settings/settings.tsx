import type { AppPreferences, Methods } from '@just-notch/bridge-schema'
import { type SettingsPermission, SettingsWindow } from '@justanarthur/modo-ui-notch'
import { useEffect, useState } from 'react'
import { call } from '../host/client'
import { useHostInfo, useInstalled } from '../host/session'
import { subscribeTopic } from '../host/topics'
import { usePlugins } from '../plugins/loader'
import PluginView from '../plugins/plugin-view'

type SystemPermission = Methods['permissions.status']['params']['permission']
const PRIVACY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_'

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
        { label: 'Mode', value: info.devMode ? `Development${info.devServerUrl ? ` · ${info.devServerUrl}` : ''}` : 'Release' },
        { label: 'Screen', value: info.geometry.hasNotch ? 'Hardware notch' : 'Virtual notch' },
      ]
    : []

  // The kit's sidebar pads its labels 16 px in from its edge: pulled out by as much, its text lines up with the
  // island's title and tabs (INSET), the row highlights reaching into the margin as they do in a list.
  return (
    <div className="-mx-4 h-full">
      <SettingsWindow
        name="Just Notch"
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
