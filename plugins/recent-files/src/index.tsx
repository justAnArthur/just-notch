import { type RecentDownload, type RecentFile as KitFile, RecentFiles, Widget } from '@justanarthur/modo-ui-notch'
import { Button, List } from '@justanarthur/modo-ui'
import { type ActiveDownload, definePlugin, type PluginContext, type RecentFile, SelectRow, signal, SwitchRow, usePlugin, useSheet, useStorage, useTopic } from '@just-notch/sdk'
import { FolderDown, FolderLock } from 'lucide-react'
import { useEffect, useState } from 'react'

const SOURCES = 'sources'
const SHOW = 'show'
const FLASH = 'flashOnSave'
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

const thumbnails = new Map<string, string | null>()

/** QuickLook thumbnails for the files shown, fetched once each. */
function useThumbnails(files: RecentFile[]) {
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
  return (file: RecentFile): KitFile => ({ ...file, thumbnail: thumbnails.get(file.id) ?? undefined })
}

function useFiles() {
  const state = useTopic('recentFiles')
  const [sources] = useStorage(SOURCES, ALL)
  const [show] = useStorage(SHOW, 12)
  const files = (state?.files ?? []).filter((f) => sources[f.source])
  const shown = (['downloads', 'screenshots'] as const).flatMap((s) => files.filter((f) => f.source === s).slice(0, show))
  return { state, files: shown, download: sources.downloads ? toDownload(state?.downloads[0]) : null }
}

function Files() {
  const { call } = usePlugin()
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

const LABEL: Record<RecentFile['source'], string> = { downloads: 'Downloads folder', screenshots: 'Screenshots folder' }

function FolderRow({ source }: { source: RecentFile['source'] }) {
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

function Settings() {
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
      <List.Section title="Folders">
        <FolderRow source="downloads" />
        <FolderRow source="screenshots" />
      </List.Section>
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
    </List>
  )
}

/** Watches both folders while the plugin runs: a flash when a file lands, the wings while a download is under way. */
function activate(ctx: PluginContext) {
  let seen: Set<string> | undefined
  let shown = false

  const stop = ctx.subscribe('recentFiles', async (state) => {
    const sources = (await ctx.storage.get<Sources>(SOURCES)) ?? ALL
    const download = sources.downloads ? toDownload(state.downloads[0]) : null
    downloading.set(download)
    if (download && !shown) ctx.activity.show({ priority: 'device', title: 'Downloads', compact: { leading: Leading, trailing: Trailing }, minimal: Minimal, expanded: Files })
    if (!download && shown) ctx.activity.hide()
    shown = !!download

    const fresh = seen ? state.files.filter((f) => !seen?.has(f.id) && sources[f.source]) : []
    seen = new Set(state.files.map((f) => f.id))
    const newest = fresh.sort((a, b) => b.addedAt - a.addedAt)[0]
    if (!newest || ctx.island.get() === 'expanded' || (await ctx.storage.get<boolean>(FLASH)) === false) return
    const thumbnail = await ctx.call('files.thumbnail', { path: newest.id, size: THUMBNAIL }).then((r) => r.url, () => undefined)
    landed.set({ ...newest, thumbnail })
    ctx.activity.flash({ priority: 'alert', key: 'saved', view: Saved, durationMs: 4000 })
  })

  return () => {
    stop()
    if (shown) ctx.activity.hide()
  }
}

export default definePlugin({
  activate,
  widget: { title: 'Recent files', icon: FolderDown, view: Files },
  settings: Settings,
})
