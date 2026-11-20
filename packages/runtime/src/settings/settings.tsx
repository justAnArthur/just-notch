import type { AppPreferences, InstalledPlugin, LibraryEntry, Methods, UpdaterPreferences, UpdateState } from '@just-notch/bridge-schema'
import { Badge, Button, LIST_SWITCH, List, Switch } from '@justanarthur/modo-ui'
import { type PermissionState, type SettingsPermission, SettingsWindow } from '@justanarthur/modo-ui-notch'
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
import { lastCheckedText } from './updates'
import appIcon from '../../../../assets/brand/icon.svg'

type SystemPermission = Methods['permissions.status']['params']['permission']
const PRIVACY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_'
const REPO = 'https://github.com/justAnArthur/just-notch'
const COPYRIGHT_YEAR = 2026

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

/** The host's own errors are already in words; a failed call gets these. */
const CHECK_FAILED = "Couldn't check for updates. Try again later."

/** Sparkle's switches and last check; read again after each check, which moves the time. */
function useUpdaterPreferences() {
  const [preferences, setPreferences] = useState<UpdaterPreferences>()
  const reload = () => void call('runtime', 'updater.preferences', {}).then(setPreferences, () => {})
  useEffect(reload, [])
  const change = (next: Partial<Pick<UpdaterPreferences, 'automaticChecks' | 'automaticDownloads'>>) => {
    setPreferences((current) => current && { ...current, ...next })
    void call('runtime', 'updater.setPreferences', next).then(setPreferences, reload)
  }
  return [preferences, change, reload] as const
}

/** Sparkle checks here; installing opens its own window, whose steps (and the menu's, and scheduled checks') come back as `updater.state`. */
function Updates({ onChecked }: { onChecked: () => void }) {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' })
  const [checked, setChecked] = useState(false)
  useEffect(() => on('updater.state', setState), [])

  const check = async () => {
    setState({ kind: 'checking' })
    setState(await call('runtime', 'updater.check', {}).catch(() => ({ kind: 'error', message: CHECK_FAILED }) as const))
    setChecked(true)
    onChecked()
  }
  const install = () => void call('runtime', 'updater.install', {}).catch(() => setState({ kind: 'error', message: CHECK_FAILED }))
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
          Check now
        </Button>
      )}
    </span>
  )
}

/** Whether ⌥ is held, followed while `active` (the About page is open): keys, and the pointer's modifier flag. */
function useOptionHeld(active: boolean) {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!active) return setHeld(false)
    const follow = (event: KeyboardEvent | PointerEvent) => setHeld(event.altKey)
    const release = () => setHeld(false)
    window.addEventListener('keydown', follow)
    window.addEventListener('keyup', follow)
    window.addEventListener('pointermove', follow)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', follow)
      window.removeEventListener('keyup', follow)
      window.removeEventListener('pointermove', follow)
      window.removeEventListener('blur', release)
    }
  }, [active])
  return held
}

/** Each row names what it powers, so a missing grant reads as a feature that won't work, not a setting. */
const PERMISSIONS: (Pick<SettingsPermission, 'id' | 'label' | 'description'> & { url: string; status?: SystemPermission })[] = [
  {
    id: 'accessibility',
    status: 'accessibility',
    url: `${PRIVACY}Accessibility`,
    label: 'Accessibility',
    description: 'Moves and resizes windows, and pastes from clipboard history.',
  },
  { id: 'calendar', status: 'calendar', url: `${PRIVACY}Calendars`, label: 'Calendar', description: 'Shows your next event and a countdown to it.' },
  { id: 'location', status: 'location', url: `${PRIVACY}LocationServices`, label: 'Location', description: 'Gets the weather where you are.' },
  { id: 'automation', status: 'automation', url: `${PRIVACY}Automation`, label: 'Automation', description: 'Plays, pauses and skips in Music and Spotify.' },
  { id: 'files', url: `${PRIVACY}FilesAndFolders`, label: 'Downloads and Desktop', description: 'Lists your recent downloads and screenshots.' },
  { id: 'bluetooth', status: 'bluetooth', url: `${PRIVACY}Bluetooth`, label: 'Bluetooth', description: 'Shows connected headphones and their battery.' },
  {
    id: 'notifications',
    status: 'notifications',
    url: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
    label: 'Notifications',
    description: 'Lets plugins alert you, such as when a timer ends.',
  },
]
/** How often the Permissions page asks again while it's shown: a grant in System Settings shows within this. */
const RECHECK_MS = 2000

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

/**
 * Each permission's state, asked on mount, whenever the island's page comes back (the app activates or the
 * page shows again), and every 2 s while `watching` (the Permissions page is open and visible).
 */
function usePermissionStates(watching: boolean) {
  const [states, setStates] = useState<Record<string, PermissionState>>({})
  const put = (id: string, state: PermissionState) => setStates((current) => (current[id] === state ? current : { ...current, [id]: state }))
  useEffect(() => {
    const check = () => {
      for (const { id, status } of PERMISSIONS)
        if (status) void call('runtime', 'permissions.state', { permission: status }).then((r) => put(id, r.state), () => {})
    }
    check()
    const visible = () => document.visibilityState === 'visible' && check()
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', visible)
    const timer = watching ? setInterval(() => document.visibilityState === 'visible' && check(), RECHECK_MS) : undefined
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', visible)
      clearInterval(timer)
    }
  }, [watching])
  // The folders have no check that doesn't prompt: the recent files watcher already knows.
  useEffect(
    () =>
      subscribeTopic('recentFiles', ({ access }) => put('files', access === 'granted' ? 'allowed' : access === 'denied' ? 'off' : 'notAsked')),
    [],
  )
  return states
}

/**
 * What a row says beyond the kit's own line for its state. The app never resets a grant itself (no `tccutil`):
 * Fix opens the pane with the steps. Allow… on a permission not asked yet shows macOS's prompt now; the row's
 * description is the explanation.
 */
function permissionRow(permission: (typeof PERMISSIONS)[number], state: PermissionState | undefined): SettingsPermission {
  const { id, label, description } = permission
  if (state === 'stale')
    return {
      id,
      label,
      description,
      state,
      note: "System Settings shows it as on, but macOS isn't honouring it. Fix opens the list: remove Just Notch with −, add it back with +, then come back.",
    }
  if (state === 'notAsked' && id === 'accessibility')
    return { id, label, description, state, note: 'macOS asks, then opens System Settings: turn on Just Notch and come back.' }
  return { id, label, description, state }
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
            <Button variant="secondary" size="compact" className={LIST_SWITCH} onClick={() => revoke(host)}>
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
  const target = useSettingsTarget()
  const permissionStates = usePermissionStates(target.page === 'permissions')
  const library = useLibrary()
  const optionHeld = useOptionHeld(target.page === 'about')
  const [updater, setUpdater, reloadUpdater] = useUpdaterPreferences()
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

  // The header carries the identity; ⌥ held shows what a bug report needs (the build's mode only in development).
  const aboutHeader = info && {
    icon: <img src={appIcon} alt="" className="size-16" />,
    name: 'Just Notch',
    version: `Version ${info.version}`,
    copyright: `© ${COPYRIGHT_YEAR} justAnArthur`,
  }
  const about = info
    ? [
        { label: updater ? lastCheckedText(updater.lastChecked) : 'Updates', value: <Updates onChecked={reloadUpdater} /> },
        ...(updater
          ? [
              // The kit's About value is an inline span: the flex wrapper gives the Switch its size.
              {
                label: 'Check automatically',
                value: (
                  <span className="flex">
                    <Switch
                      aria-label="Check for updates automatically"
                      checked={updater.automaticChecks}
                      onCheckedChange={(automaticChecks) => setUpdater({ automaticChecks })}
                    />
                  </span>
                ),
              },
              {
                label: 'Download automatically',
                value: (
                  <span className="flex">
                    <Switch
                      aria-label="Download updates automatically"
                      checked={updater.automaticDownloads}
                      disabled={!updater.automaticChecks}
                      onCheckedChange={(automaticDownloads) => setUpdater({ automaticDownloads })}
                    />
                  </span>
                ),
              },
            ]
          : []),
        ...(optionHeld
          ? [
              ...(info.devMode ? [{ label: 'Mode', value: `Development${info.devServerUrl ? ` · ${info.devServerUrl}` : ''}` }] : []),
              { label: 'Screen', value: info.geometry.hasNotch ? 'Hardware notch' : 'Virtual notch' },
              { label: 'Plugin API', value: info.apiVersion },
            ]
          : []),
        { label: 'Website', value: <Link url="https://justanarthur.github.io/just-notch/">justanarthur.github.io/just-notch</Link> },
        { label: 'License', value: <Link url={`${REPO}/blob/main/LICENSE.md`}>FSL-1.1-MIT</Link> },
        {
          label: 'First steps',
          value: (
            <Button variant="link" size="compact" onClick={() => void call('runtime', 'onboarding.open', {})}>
              Show Welcome…
            </Button>
          ),
        },
      ]
    : []

  // `flush` drops the sidebar's own inset; its rows keep 8 px of padding, so pulled out by that much the text
  // lines up with the island's title and tabs (INSET), the row highlights reaching into the margin as in a list.
  return (
    <div className="-mx-2 h-full">
      <SettingsWindow
        name="Just Notch settings"
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
        permissions={PERMISSIONS.map((permission) => permissionRow(permission, permissionStates[permission.id]))}
        onFixPermission={(id, state) => {
          const permission = PERMISSIONS.find((p) => p.id === id)
          if (!permission) return
          if (state === 'notAsked' && permission.status) void call('runtime', 'permissions.request', { permission: permission.status })
          else void call('runtime', 'system.openUrl', { url: permission.url })
        }}
        aboutHeader={aboutHeader}
        about={about}
      />
    </div>
  )
}
