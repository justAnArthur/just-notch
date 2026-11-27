import type { InstalledPlugin, LibraryCatalog, LibraryEntry as CatalogEntry, Permission } from '@just-notch/bridge-schema'
import { type LibraryEntry, LibraryListing, type LibraryPermission } from '@justanarthur/modo-ui-notch'
import { Button, List } from '@justanarthur/modo-ui'
import { useCallback, useEffect, useState } from 'react'
import { on } from '../host/bus'
import { call, log } from '../host/client'
import { entryState, librarySections, needsAppUpdate, type Progress } from './library-state'

/** Every permission in plain words, as the host's install dialog puts them (Library/Consent.swift). */
export const PERMISSION_INFO: Record<Permission, LibraryPermission> = {
  'media.read': { label: 'Now playing', description: 'Sees what’s playing in your music and video apps.' },
  'media.control': { label: 'Media control', description: 'Plays, pauses and skips in your media apps.' },
  'power.read': { label: 'Battery', description: 'Sees your battery level and whether it’s charging.' },
  'network.read': { label: 'Connection', description: 'Sees whether you’re online, over Wi-Fi or a VPN, and during calls how quick the connection is.' },
  reminders: { label: 'Reminders', description: 'Sees your due reminders, and adds, completes and snoozes them in Apple Reminders.' },
  'screen.read': { label: 'Screen text', description: 'Reads the text and QR codes in a part of the screen you pick. Nothing leaves your Mac.' },
  'power.control': { label: 'Keep awake', description: 'Keeps your Mac, and its display if asked, from going to sleep.' },
  'audio.read': { label: 'Volume', description: 'Sees the volume and which speakers or headphones play.' },
  'audio.control': { label: 'Volume control', description: 'Changes the volume.' },
  'display.control': { label: 'Brightness', description: 'Sees and changes the screen and keyboard brightness.' },
  hud: { label: 'Volume and brightness keys', description: 'Shows its own overlay in place of the system’s when you press them.' },
  'calendar.read': { label: 'Calendar', description: 'Reads your calendar events; it can’t change them.' },
  files: { label: 'Files', description: 'Opens, previews, shares and moves to the Trash the files you give it.' },
  'bluetooth.read': { label: 'Bluetooth', description: 'Sees your Bluetooth devices and their battery.' },
  'stats.read': { label: 'System stats', description: 'Sees CPU, memory, network and disk use, and the busiest apps.' },
  'weather.read': { label: 'Weather', description: 'Gets the weather where you are.' },
  clipboard: { label: 'Clipboard', description: 'Reads what you copy and your clipboard history.' },
  'files.recent': { label: 'Recent files', description: 'Sees your recent downloads and screenshots.' },
  'apps.read': { label: 'Apps', description: 'Sees your installed apps.' },
  'apps.launch': { label: 'Opening apps', description: 'Opens your apps.' },
  'files.search': { label: 'File search', description: 'Finds your files and folders by name.' },
  net: { label: 'Internet', description: 'Connects to the hosts listed below, and to others only if you allow them.' },
  hotkeys: { label: 'Keyboard shortcuts', description: 'Listens for the global shortcuts you give it.' },
  windows: { label: 'Windows', description: 'Moves and resizes the window in front.' },
  secrets: { label: 'Keychain', description: 'Keeps passwords and tokens in your Keychain, out of the plugin’s files.' },
}

/** The kit's entries for the catalog, in its order. */
export function libraryEntries(
  catalog: CatalogEntry[],
  installed: InstalledPlugin[],
  apiVersion: string,
  progress: Record<string, Progress> = {},
  failures: Record<string, string> = {},
): LibraryEntry[] {
  return catalog.map((entry) => ({
    id: entry.id,
    name: entry.name,
    version: entry.version,
    description: entry.description ?? '',
    author: entry.author,
    icon: entry.icon,
    permissions: entry.permissions,
    hosts: entry.hosts,
    state: entryState(entry, installed.find((p) => p.manifest.id === entry.id), apiVersion, progress[entry.id], failures[entry.id]),
    screenshots: entry.screenshots.map((url) => <img key={url} src={url} alt="" className="size-full object-cover" />),
    source: entry.source,
  }))
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const cancelled = (error: unknown) => message(error) === 'cancelled'

/** The catalog from the host, installs and uninstalls with their progress, and what failed. */
export function useLibrary() {
  const [catalog, setCatalog] = useState<LibraryCatalog>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [failures, setFailures] = useState<Record<string, string>>({})

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true)
    try {
      setCatalog(await call('runtime', 'library.catalog', { refresh }))
      setError(undefined)
    } catch (e) {
      log('warn', `library.catalog: ${message(e)}`)
      setError(message(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
    return on('library.progress', (step) => {
      setProgress(({ [step.id]: _, ...rest }) => (step.phase === 'done' || step.phase === 'error' ? rest : { ...rest, [step.id]: step }))
      if (step.phase === 'error' && step.message !== 'cancelled') setFailures((f) => ({ ...f, [step.id]: step.message ?? 'The install failed.' }))
    })
  }, [load])

  const fail = (id: string) => (e: unknown) => {
    if (!cancelled(e)) setFailures((f) => ({ ...f, [id]: message(e) }))
  }

  const install = (id: string) => {
    setFailures(({ [id]: _, ...rest }) => rest)
    setProgress((p) => ({ ...p, [id]: { id, phase: 'downloading', progress: 0 } }))
    void call('runtime', 'library.install', { id })
      .catch(fail(id))
      .finally(() => setProgress(({ [id]: _, ...rest }) => rest))
  }

  const uninstall = (id: string) => {
    setFailures(({ [id]: _, ...rest }) => rest)
    void call('runtime', 'library.uninstall', { id }).catch(fail(id))
  }

  return { catalog, loading, error, progress, failures, refresh: () => load(true), install, uninstall }
}

export type Library = ReturnType<typeof useLibrary>

const openUrl = (url: string) => void call('runtime', 'system.openUrl', { url })

/** The Library page: the catalog, or one plugin's page while `open` names it. */
export default function LibraryPage({
  library,
  installed,
  apiVersion,
  open,
  onOpen,
}: {
  library: Library
  installed: InstalledPlugin[]
  apiVersion: string
  open?: string
  onOpen: (id: string | undefined) => void
}) {
  const { catalog, loading, error, progress, failures, install, uninstall, refresh } = library
  const entries = libraryEntries(catalog?.plugins ?? [], installed, apiVersion, progress, failures)
  const actions = { permissionInfo: PERMISSION_INFO, onInstall: install, onUpdate: install, onUninstall: uninstall }
  const entry = entries.find((e) => e.id === open)

  if (entry) return <LibraryListing.Detail entry={entry} onBack={() => onOpen(undefined)} onOpenSource={openUrl} {...actions} />
  if (!catalog || entries.length === 0)
    return (
      <LibraryListing
        entries={entries}
        loading={!catalog && (loading || !error)}
        error={!catalog && error ? 'Couldn’t reach the library. Check your connection and try again.' : undefined}
        onRetry={() => void refresh()}
        onOpen={onOpen}
        {...actions}
      />
    )

  const sections = librarySections(entries, new Set(installed.map((p) => p.manifest.id)))
  const waitingOnApp = sections.waiting.filter((e) => e.state.status === 'incompatible' && needsAppUpdate(e.state.reason))
  return (
    <div className="flex flex-col gap-6">
      {sections.installed.length > 0 && <LibraryListing title="Installed" entries={sections.installed} onOpen={onOpen} {...actions} />}
      {sections.available.length > 0 ? (
        <LibraryListing title="Available" entries={sections.available} onOpen={onOpen} {...actions} />
      ) : (
        <p className="m-0 pl-2 text-body text-muted-foreground">You have every plugin in the library.</p>
      )}
      {waitingOnApp.length > 0 && (
        <List>
          <List.Row
            label={waitingOnApp.length === 1 ? `${waitingOnApp[0]?.name} needs a newer Just Notch` : `${waitingOnApp.length} plugins need a newer Just Notch`}
            description={waitingOnApp.length === 1 ? 'Update Just Notch to install it.' : 'Update Just Notch to install them.'}
          >
            <Button variant="secondary" size="compact" className="mr-3" onClick={() => void call('runtime', 'updater.install', {}).catch(() => {})}>
              Update…
            </Button>
          </List.Row>
        </List>
      )}
    </div>
  )
}
