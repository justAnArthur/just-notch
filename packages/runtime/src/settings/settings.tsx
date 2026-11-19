import type { AppPreferences, InstalledPlugin, LibraryEntry, Methods, UpdateState } from '@just-notch/bridge-schema'
import { Badge, Button, List } from '@justanarthur/modo-ui'
import { type SettingsPermission, SettingsWindow } from '@justanarthur/modo-ui-notch'
import { Library, Search } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { on } from '../host/bus'
import { call } from '../host/client'
import { useHostInfo, useInstalled } from '../host/session'
import { subscribeTopic } from '../host/topics'
import { usePlugins } from '../plugins/loader'
import PluginView from '../plugins/plugin-view'
import LauncherPage, { type PreferenceChange } from './launcher'
import LibraryPage, { useLibrary } from './library'
import { entryState, updateCount } from './library-state'
import { setSettingsTarget, useSettingsTarget } from './target'

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

/** The host's preferences; a change shows at once and settles to what the host kept (a taken shortcut isn't). */
function usePreferences() {
  const [preferences, setPreferences] = useState<AppPreferences>()
  const [error, setError] = useState<string>()
  const reload = () => void call('runtime', 'app.preferences', {}).then(setPreferences)
  useEffect(reload, [])
  const change = (next: PreferenceChange) => {
    setError(undefined)
    setPreferences((current) => current && { ...current, ...next, launcher: { ...current.launcher, ...next.launcher } })
    void call('runtime', 'app.setPreferences', next).then(setPreferences, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
      reload()
    })
  }
  return [preferences, change, error] as const
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

/** A plugin row's label: why it doesn't run, a newer version in the library, or where it came from. */
function pluginBadge(plugin: InstalledPlugin, entry: LibraryEntry | undefined, apiVersion: string): ReactNode {
  if (plugin.incompatible && !(entry && entryState(entry, plugin, apiVersion).status === 'update-available'))
    return (
      <Badge size="compact" color="amber">
        Incompatible
      </Badge>
    )
  if (entry && entryState(entry, plugin, apiVersion).status === 'update-available')
    return (
      <Badge size="compact" color="blue">
        Update
      </Badge>
    )
  if (plugin.source === 'library') return <Badge size="compact">Library</Badge>
}

/**
 * The hosts the user let a plugin reach beyond its manifest (`net.requestHost`), each with Revoke. Read as the
 * plugin, as its own context does: `net.hosts` answers for the caller only.
 */
function HostGrants({ plugin }: { plugin: string }) {
  const [granted, setGranted] = useState<string[]>([])
  useEffect(() => {
    void call(plugin, 'net.hosts', {}).then((hosts) => setGranted(hosts.granted), () => {})
  }, [plugin])
  if (granted.length === 0) return null
  const revoke = (host: string) =>
    void call('runtime', 'net.revokeHost', { plugin, host }).then(() => setGranted((hosts) => hosts.filter((h) => h !== host)))
  return (
    <List>
      <List.Section title="Allowed hosts">
        {granted.map((host) => (
          <List.Row key={host} label={host} description="You let it connect here.">
            <Button variant="secondary" size="compact" onClick={() => revoke(host)}>
              Revoke
            </Button>
          </List.Row>
        ))}
      </List.Section>
    </List>
  )
}

/**
 * The settings page inside the open island, on its tall snap: the kit's General, Plugins, Permissions and
 * About, and each running plugin's own page. A disabled plugin isn't loaded, so it lists without a page.
 */
export default function Settings() {
  const info = useHostInfo()
  const installed = useInstalled()
  const loaded = usePlugins()
  const [preferences, setPreferences, preferencesError] = usePreferences()
  const granted = useGranted()
  const library = useLibrary()
  const target = useSettingsTarget()
  const apiVersion = info?.apiVersion ?? '0.0.0'

  // Opening the Library asks for a fresh catalog.
  useEffect(() => {
    if (target.page === 'library') void library.refresh()
  }, [target.page === 'library'])

  const plugins = installed.map((plugin) => {
    const { manifest, source } = plugin
    const definition = loaded.find((p) => p.installed.manifest.id === manifest.id)?.definition
    const entry = library.catalog?.plugins.find((e) => e.id === manifest.id)
    return {
      id: manifest.id,
      name: manifest.name,
      description: plugin.incompatible ?? manifest.description,
      icon: definition?.widget?.icon,
      badge: pluginBadge(plugin, entry, apiVersion),
      actions: source !== 'builtIn' && (
        <Button variant="ghost" size="compact" onClick={() => library.uninstall(manifest.id)}>
          Uninstall
        </Button>
      ),
      settings: definition?.settings && (
        <>
          <PluginView plugin={manifest.id} view={definition.settings} />
          {manifest.permissions.includes('net') && <HostGrants plugin={manifest.id} />}
        </>
      ),
    }
  })

  const updates = updateCount(library.catalog?.plugins, installed, apiVersion)
  const pages = [
    {
      id: 'launcher',
      label: 'Launcher',
      lead: 'Spotlight-style search that drops out of the notch.',
      icon: Search,
      after: 'general',
      content: <LauncherPage preferences={preferences} error={preferencesError} onChange={setPreferences} />,
    },
    {
      id: 'library',
      label: 'Library',
      lead: 'Plugins to install from the Just Notch library.',
      icon: Library,
      after: 'plugins',
      badge: updates > 0 ? String(updates) : undefined,
      content: (
        <LibraryPage
          library={library}
          installed={installed}
          apiVersion={apiVersion}
          open={target.library}
          onOpen={(id) => setSettingsTarget({ page: 'library', library: id })}
        />
      ),
    },
  ]

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
        value={target.page}
        onValueChange={(page) => setSettingsTarget({ page })}
        pages={pages}
        preferences={preferences}
        onPreferencesChange={({ launchAtLogin, screens }) => setPreferences({ launchAtLogin, screens })}
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
