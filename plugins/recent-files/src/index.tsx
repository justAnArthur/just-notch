import { IslandFlash, type RecentDownload, type RecentFile as KitFile, RecentFiles, Widget } from '@justanarthur/modo-ui-notch'
import { Button, List } from '@justanarthur/modo-ui'
import { type ActiveDownload, type WatchedSource, definePlugin, type Unsubscribe, type PluginContext, type RecentFile, type RecentFilesState, SelectRow, signal, SwitchRow, usePlugin, useSheet, useStorage, useTopic } from '@just-notch/sdk'
import { Archive, FolderDown, FolderLock } from 'lucide-react'
import { useEffect, useState } from 'react'

const SOURCES = 'sources'
const SHOW = 'show'
const FLASH = 'flashOnSave'
/** Dropping files on the notch keeps copies on the shelf. */
const DROP = 'dropToKeep'
/** Set once the tab is first opened or access is allowed in Settings: until then nothing touches the folders, so
 * macOS asks for Downloads and Desktop only when the user comes to them, not at launch. */
const WATCHING = 'watching'
const THUMBNAIL = 96
const PRIVACY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'

interface Sources {
  downloads: boolean
  screenshots: boolean
}
const ALL: Sources = { downloads: true, screenshots: true }

/** A download whose size is known; the kit's progress needs one. */
const toDownload = (d: ActiveDownload | undefined): RecentDownload | null =>
  d?.total ? { id: d.id, name: d.name, received: d.received, total: d.total, rate: d.rate, from: d.from } : null

/** A file the kit can list: its lists know only the watched folders. */
type FolderFile = RecentFile & { source: WatchedSource }
const fromFolder = (f: RecentFile): f is FolderFile => f.source !== 'shelf'
/** Until the kit has a shelf tab, kept copies list with the downloads, marked as kept. */
const listed = (f: RecentFile): FolderFile => (fromFolder(f) ? f : { ...f, source: 'downloads', from: 'kept on the shelf' })

const thumbnails = new Map<string, string | null>()

/** QuickLook thumbnails for the files shown, fetched once each. */
function useThumbnails(files: FolderFile[]) {
  const { call } = usePlugin()
  const [, rerender] = useState(0)
  useEffect(() => {
    let live = true
    for (const file of files) {
      if (thumbnails.has(file.id)) continue
      thumbnails.set(file.id, null)
      call('files.thumbnail', { path: file.id, size: THUMBNAIL })
        .then(({ url }) => thumbnails.set(file.id, url))
        .catch(() => {})
        .finally(() => live && rerender((n) => n + 1))
    }
    return () => {
      live = false
    }
  }, [call, files])
  return (file: FolderFile): KitFile => ({ ...file, thumbnail: thumbnails.get(file.id) ?? undefined })
}

function useFiles() {
  const state = useTopic('recentFiles')
  const [sources] = useStorage(SOURCES, ALL)
  const [show] = useStorage(SHOW, 12)
  const files = (state?.files ?? []).map(listed).filter((f) => sources[f.source])
  const shown = (['downloads', 'screenshots'] as const).flatMap((s) => files.filter((f) => f.source === s).slice(0, show))
  return { state, files: shown, download: sources.downloads ? toDownload(state?.downloads[0]) : null }
}

function Files() {
  const { call, storage } = usePlugin()
  useEffect(() => void storage.set(WATCHING, true), [storage])
  const { state, files, download } = useFiles()
  const withThumbnail = useThumbnails(files)
  const layout = useSheet()

  if (state?.access === 'denied')
    return (
      <Widget.Message
        icon={FolderLock}
        title="Downloads and Desktop are off-limits"
        description="Allow Just Notch under Privacy & Security › Files and Folders."
        actions={
          <Button variant="secondary" size="compact" onClick={() => void call('system.openUrl', { url: PRIVACY_URL })}>
            Open System Settings
          </Button>
        }
      />
    )

  return (
    <RecentFiles
      layout={layout}
      files={files.map(withThumbnail)}
      download={download}
      onOpen={(file) => void call('files.open', { path: file.id })}
      onReveal={(file) => void call('files.reveal', { path: file.id })}
      onCopy={(file) => void call('files.copy', { paths: [file.id] })}
      onDelete={(file) => void call('files.trash', { path: file.id })}
      onClear={(source) => void call('recentFiles.clear', { source })}
      onCancelDownload={(d) => void call('recentFiles.cancelDownload', { id: d.id })}
      onDragStart={(file, event) => {
        event.preventDefault()
        void call('files.beginDrag', { paths: [file.id] })
      }}
    />
  )
}

const landed = signal<KitFile | undefined>(undefined)
const downloading = signal<RecentDownload | null>(null)

function Saved() {
  const { call } = usePlugin()
  const file = landed.use()
  return file ? <RecentFiles.Saved file={file} onOpen={(f) => void call('files.open', { path: f.id })} /> : null
}

function Leading() {
  return <RecentFiles.Leading source="downloads" />
}

function Trailing() {
  return <RecentFiles.Trailing download={downloading.use()} />
}

function Minimal() {
  const download = downloading.use()
  return download ? <RecentFiles.Minimal download={download} /> : null
}

const LABEL: Record<WatchedSource, string> = { downloads: 'Downloads folder', screenshots: 'Screenshots folder' }

function FolderRow({ source }: { source: WatchedSource }) {
  const { call } = usePlugin()
  const folder = useTopic('recentFiles')?.folders[source]
  return (
    <List.Row label={LABEL[source]} description={folder?.path}>
      {folder?.custom && (
        <Button variant="ghost" size="compact" onClick={() => void call('recentFiles.resetFolder', { source })}>
          Reset
        </Button>
      )}
      <Button variant="secondary" size="compact" onClick={() => void call('recentFiles.chooseFolder', { source })}>
        Choose…
      </Button>
    </List.Row>
  )
}

/** Before the first watch: one row to allow access, instead of folder rows that would ask macOS straight away. */
function Access({ onAllow }: { onAllow: () => void }) {
  return (
    <List.Section title="Folders">
      <List.Row label="Downloads and screenshots" description="macOS asks once for each folder. Opening the tab asks too.">
        <Button variant="secondary" size="compact" onClick={onAllow}>
          Allow access
        </Button>
      </List.Row>
    </List.Section>
  )
}

const HOUR = 1
const EXPIRY = [
  { value: '1', label: '1 hour' },
  { value: '24', label: '1 day' },
  { value: '168', label: '1 week' },
  { value: 'never', label: 'Until cleared' },
]
const GB = 1024 ** 3
const LIMITS = [0.5, 2, 10].map((gb) => ({ value: String(gb * GB), label: gb < 1 ? `${gb * 1024} MB` : `${gb} GB` }))

function Shelf() {
  const { call } = usePlugin()
  const [drop, setDrop] = useStorage(DROP, true)
  const [expiry, setExpiry] = useStorage<string>('shelfExpiry', '24')
  const [limit, setLimit] = useStorage<string>('shelfLimit', String(2 * GB))
  return (
    <List.Section title="Shelf">
      <SwitchRow
        label="Drop to keep"
        description="Drag files onto the notch to keep copies in Recent files; the originals stay where they are."
        checked={drop}
        onCheckedChange={setDrop}
      />
      <SelectRow
        label="Keep for"
        description="Kept files go after this long."
        options={EXPIRY}
        value={expiry}
        onValueChange={(v) => {
          setExpiry(v)
          void call('recentFiles.setShelf', { expiryHours: v === 'never' ? null : Number(v) * HOUR })
        }}
      />
      <SelectRow
        label="Up to"
        description="Past this the oldest go first, and a bigger file isn't kept."
        options={LIMITS}
        value={limit}
        onValueChange={(v) => {
          setLimit(v)
          void call('recentFiles.setShelf', { limitBytes: Number(v) })
        }}
      />
      <List.Row label="Empty the shelf" description="Deletes the kept copies, never the originals.">
        <Button variant="secondary" size="compact" onClick={() => void call('recentFiles.clear', { source: 'shelf' })}>
          Empty
        </Button>
      </List.Row>
    </List.Section>
  )
}

function Settings() {
  const [watching, setWatching] = useStorage(WATCHING, false)
  const [sources, setSources] = useStorage(SOURCES, ALL)
  const [show, setShow] = useStorage(SHOW, 12)
  const [flash, setFlash] = useStorage(FLASH, true)
  return (
    <List>
      <List.Section title="Sources">
        <SwitchRow
          label="Downloads"
          description="Files as they finish downloading, and a download under way."
          checked={sources.downloads}
          onCheckedChange={(downloads) => setSources({ ...sources, downloads })}
        />
        <SwitchRow
          label="Screenshots"
          description="Each screenshot as it is saved."
          checked={sources.screenshots}
          onCheckedChange={(screenshots) => setSources({ ...sources, screenshots })}
        />
      </List.Section>
      {watching ? (
        <List.Section title="Folders">
          <FolderRow source="downloads" />
          <FolderRow source="screenshots" />
        </List.Section>
      ) : (
        <Access onAllow={() => setWatching(true)} />
      )}
      <List.Section title="List">
        <SelectRow
          label="Show"
          description="How many files each list keeps, the newest first."
          options={[6, 12, 20].map((n) => ({ value: String(n), label: `${n} files` }))}
          value={String(show)}
          onValueChange={(v) => setShow(Number(v))}
        />
        <SwitchRow
          label="Flash when a file lands"
          description="Shows the file below the notch for a moment, with Open."
          checked={flash}
          onCheckedChange={setFlash}
        />
      </List.Section>
      <Shelf />
    </List>
  )
}

const dragging = signal(0)
const kept = signal<string[]>([])

function DropTarget() {
  const count = dragging.use()
  return <IslandFlash icon={<Archive />} title="Drop to keep" caption={count === 1 ? 'Keeps a copy in Recent files' : `Keeps ${count} copies in Recent files`} />
}

function Kept() {
  const { call } = usePlugin()
  const paths = kept.use()
  return (
    <IslandFlash
      tone="success"
      icon={<Archive />}
      title={paths.length === 1 ? 'Kept' : `Kept ${paths.length} files`}
      caption="In Recent files"
      action={
        <Button variant="ghost" size="compact" onClick={() => void call('files.airdrop', { paths })}>
          AirDrop
        </Button>
      }
    />
  )
}

/** The notch as a drop target: a flash while files hover over it, then the copies kept, with AirDrop. */
function dropToKeep(ctx: PluginContext): Unsubscribe {
  const stops = [
    ctx.on('files.dragging', async ({ active, count }) => {
      if (!active) return ctx.activity.dismiss('drop')
      if ((await ctx.storage.get<boolean>(DROP)) === false) return
      dragging.set(count)
      ctx.activity.flash({ priority: 'alert', key: 'drop', view: DropTarget, durationMs: 30_000 })
    }),
    ctx.on('files.dropped', async ({ paths }) => {
      if ((await ctx.storage.get<boolean>(DROP)) === false) return
      const { kept: copies, skipped } = await ctx.call('recentFiles.keep', { paths })
      if (!copies.length) {
        const view = () => <IslandFlash tone="warning" icon={<Archive />} title="Not kept" caption={`${skipped.length === 1 ? 'It is' : 'They are'} too big for the shelf, or gone`} />
        return ctx.activity.flash({ priority: 'alert', key: 'kept', view, durationMs: 3000 })
      }
      kept.set(copies)
      ctx.activity.flash({ priority: 'alert', key: 'kept', view: Kept, durationMs: 5000 })
    }),
  ]
  return () => stops.forEach((stop) => stop())
}

/**
 * Watches both folders while the plugin runs, once watching was allowed: a flash when a file lands, the wings while
 * a download is under way.
 */
function activate(ctx: PluginContext) {
  let seen: Set<string> | undefined
  let shown = false
  let live = true
  let stop: Unsubscribe | undefined

  const onState = async (state: RecentFilesState) => {
    const sources = (await ctx.storage.get<Sources>(SOURCES)) ?? ALL
    const download = sources.downloads ? toDownload(state.downloads[0]) : null
    downloading.set(download)
    if (download && !shown) ctx.activity.show({ priority: 'device', title: 'Downloads', compact: { leading: Leading, trailing: Trailing }, minimal: Minimal, expanded: Files })
    if (!download && shown) ctx.activity.hide()
    shown = !!download

    const fresh = seen ? state.files.filter(fromFolder).filter((f) => !seen?.has(f.id) && sources[f.source]) : []
    seen = new Set(state.files.map((f) => f.id))
    const newest = fresh.sort((a, b) => b.addedAt - a.addedAt)[0]
    if (!newest || ctx.island.get() === 'expanded' || (await ctx.storage.get<boolean>(FLASH)) === false) return
    const thumbnail = await ctx.call('files.thumbnail', { path: newest.id, size: THUMBNAIL }).then((r) => r.url, () => undefined)
    landed.set({ ...newest, thumbnail })
    ctx.activity.flash({ priority: 'alert', key: 'saved', view: Saved, durationMs: 4000 })
  }

  const watch = (allowed: boolean | undefined) => {
    if (allowed && live && !stop) stop = ctx.subscribe('recentFiles', onState)
  }
  void ctx.storage.get<boolean>(WATCHING).then(watch)
  const unwatch = ctx.storage.subscribe<boolean>(WATCHING, watch)
  const undrop = dropToKeep(ctx)

  return () => {
    live = false
    unwatch()
    undrop()
    stop?.()
    if (shown) ctx.activity.hide()
  }
}

export default definePlugin({
  activate,
  widget: { title: 'Recent files', icon: FolderDown, view: Files },
  settings: Settings,
})
