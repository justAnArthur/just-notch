import { type ClipboardClip, ClipboardHistory } from '@justanarthur/modo-ui-notch'
import { Button, Combobox, List, Select } from '@justanarthur/modo-ui'
import { type AppInfo, type Clip, type ClipboardRetention, definePlugin, type PluginContext, type SearchAction, type SearchItem, SelectRow, signal, SwitchRow, usePlugin, useSheet, useStorage, useTopic } from '@just-notch/sdk'
import { ClipboardList, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const FLASH = 'flashOnCopy'

const toClip = (clip: Clip): ClipboardClip => ({ ...clip, color: clip.kind === 'color' ? clip.content : undefined })

/** The newest clip, for the flash. */
const copied = signal<ClipboardClip | undefined>(undefined)

function Widget() {
  const { call } = usePlugin()
  const state = useTopic('clipboard')
  const clips = state?.clips ?? []
  const pinned = clips.filter((c) => c.pinned).map((c) => c.id)

  const pin = (next: string[]) => {
    for (const clip of clips) {
      const want = next.includes(clip.id)
      if (want !== clip.pinned) void call('clipboard.pin', { id: clip.id, pinned: want })
    }
  }

  const layout = useSheet()
  return (
    <ClipboardHistory
      layout={layout}
      clips={clips.map(toClip)}
      pinned={pinned}
      onPinnedChange={pin}
      paused={state?.paused ?? false}
      onPausedChange={(paused) => void call('clipboard.setPaused', { paused })}
      onCopy={(clip) => void call('clipboard.copy', { id: clip.id })}
      onDelete={(clip) => void call('clipboard.delete', { id: clip.id })}
    />
  )
}

function Copied() {
  const { call } = usePlugin()
  const clip = copied.use()
  return clip ? <ClipboardHistory.Copied clip={clip} onPin={(c) => void call('clipboard.pin', { id: c.id, pinned: true })} /> : null
}

function AppLabel({ app }: { app: AppInfo }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {app.icon && <img src={app.icon} alt="" className="size-4 shrink-0" />}
      <span className="truncate">{app.name}</span>
    </span>
  )
}

function IgnoredApps() {
  const { call } = usePlugin()
  const ignored = useTopic('clipboard')?.ignoredApps ?? []
  const [apps, setApps] = useState<AppInfo[]>([])
  const [query, setQuery] = useState('')
  useEffect(() => {
    call('apps.list', {}).then(setApps, () => {})
  }, [call])

  const set = (next: string[]) => void call('clipboard.setIgnoredApps', { apps: next })
  const byId = new Map(apps.map((app) => [app.bundleId, app]))
  // The defaults name every password manager; list only the ones on this Mac.
  const shown = apps.length ? ignored.filter((id) => byId.has(id)) : []
  const items = apps.filter((app) => !ignored.includes(app.bundleId)).map((app) => ({ value: app.bundleId, label: <AppLabel app={app} />, textValue: app.name }))
  const add = (id: string) => {
    setQuery('')
    if (id && !ignored.includes(id)) set([...ignored, id])
  }

  return (
    <List.Section title="Never record from" aside={`${shown.length} ${shown.length === 1 ? 'app' : 'apps'}`}>
      {shown.map((id) => (
        <List.Row key={id} label={<AppLabel app={byId.get(id) ?? { bundleId: id, name: id }} />}>
          <Button variant="ghost" size="icon" aria-label={`Remove ${byId.get(id)?.name ?? id}`} onClick={() => set(ignored.filter((a) => a !== id))}>
            <X />
          </Button>
        </List.Row>
      ))}
      <List.Row label="Add an app" description="Password managers are on the list from the start.">
        <Combobox items={items} value="" onValueChange={add} query={query} onQueryChange={setQuery}>
          <Combobox.Input aria-label="App" placeholder="Search apps…" className="w-56" />
          <Combobox.Content>
            <Combobox.Empty>No app matches.</Combobox.Empty>
            <Combobox.List>
              {(item) =>
                typeof item !== 'string' && (
                  <Combobox.Item key={item.value} value={item.value}>
                    {item.label}
                  </Combobox.Item>
                )
              }
            </Combobox.List>
          </Combobox.Content>
        </Combobox>
      </List.Row>
    </List.Section>
  )
}

const MINUTE = 60_000
const KEEP_DAYS = [
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'forever', label: 'Forever' },
]
const KEEP_CLIPS = [100, 500, 1000, 5000].map((n) => ({ value: String(n), label: `${n.toLocaleString()} clips` }))
const DELETE_SPANS = [
  { value: String(5 * MINUTE), label: 'Last 5 minutes' },
  { value: String(60 * MINUTE), label: 'Last hour' },
  { value: String(24 * 60 * MINUTE), label: 'Last day' },
  { value: 'all', label: 'Everything' },
]
const STANDARD: ClipboardRetention = { limit: 1000, days: 30 }

function Retention() {
  const { call } = usePlugin()
  // The host leaves `days` out when there is no age limit.
  const retention = useTopic('clipboard')?.retention ?? STANDARD
  const days = retention.days ?? null
  const set = (next: Partial<ClipboardRetention>) => void call('clipboard.setRetention', { limit: retention.limit, days, ...next })
  const [span, setSpan] = useState(DELETE_SPANS[0].value)
  const remove = () => void call('clipboard.clear', span === 'all' ? {} : { since: Date.now() - Number(span) })

  return (
    <List.Section title="Keep">
      <SelectRow
        label="Keep history"
        description="Older clips are deleted. Pinned clips are kept."
        options={KEEP_DAYS}
        value={days === null ? 'forever' : String(days)}
        onValueChange={(v) => set({ days: v === 'forever' ? null : Number(v) })}
      />
      <SelectRow
        label="Keep at most"
        description="The oldest go first when there are more."
        options={KEEP_CLIPS.some((o) => o.value === String(retention.limit)) ? KEEP_CLIPS : [...KEEP_CLIPS, { value: String(retention.limit), label: `${retention.limit.toLocaleString()} clips` }]}
        value={String(retention.limit)}
        onValueChange={(v) => set({ limit: Number(v) })}
      />
      <List.Row label="Delete history" description="Pinned clips are kept.">
        <span className="flex items-center gap-2">
          <Select value={span} onValueChange={setSpan}>
            <Select.Trigger variant="borderless" className="min-w-0" aria-label="What to delete" />
            <Select.Content>
              {DELETE_SPANS.map((o) => (
                <Select.Item key={o.value} value={o.value}>
                  {o.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          <Button variant="secondary" size="compact" onClick={remove}>
            Delete
          </Button>
        </span>
      </List.Row>
    </List.Section>
  )
}

function Settings() {
  const { call } = usePlugin()
  const state = useTopic('clipboard')
  const [flash, setFlash] = useStorage(FLASH, false)
  return (
    <List>
      <List.Section title="History">
        <SwitchRow
          label="Pause recording"
          description="Nothing new is kept until you resume."
          checked={state?.paused ?? false}
          onCheckedChange={(paused) => void call('clipboard.setPaused', { paused })}
        />
        <SwitchRow
          label="Flash when something is copied"
          description="Shows the clip below the notch for a moment, with Pin."
          checked={flash}
          onCheckedChange={setFlash}
        />
      </List.Section>
      <Retention />
      <IgnoredApps />
      <p className="px-3 text-caption text-muted-foreground">History stays on this Mac. Copies marked as passwords are never saved.</p>
    </List>
  )
}

/** The latest history, for the launcher's search. */
let history: Clip[] = []

const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h` : `${Math.round(hours / 24)} d`
}

const KIND: Record<Clip['kind'], string> = { text: 'Text', link: 'Link', image: 'Image', color: 'Color', file: 'File' }

function clipItem(clip: Clip, ctx: PluginContext): SearchItem {
  const title = clip.kind === 'image' ? `Image ${clip.content}` : clip.kind === 'file' ? (clip.detail ?? clip.content) : clip.content.replace(/\s+/g, ' ').trim()
  return {
    id: clip.id,
    title: title.length > 120 ? `${title.slice(0, 120)}…` : title,
    subtitle: [KIND[clip.kind], clip.app].filter(Boolean).join(' · '),
    icon: clip.preview ?? (clip.kind === 'color' ? swatch(clip.content) : undefined),
    accessory: clip.pinned ? 'Pinned' : ago(clip.copiedAt),
    preview: clipPreview(clip),
    actions: clipActions(clip, ctx),
  }
}

/** ↩ paste, ⌘↩ copy, ⇧↩ paste as plain text (the first three, by order), ⌘. pin, ⌘⌫ delete. */
function clipActions(clip: Clip, ctx: PluginContext): SearchAction[] {
  return [
    { title: 'Paste', run: () => void ctx.call('clipboard.paste', { id: clip.id }) },
    { title: 'Copy', run: () => void ctx.call('clipboard.copy', { id: clip.id }) },
    { title: 'Paste as Plain Text', run: () => void ctx.call('clipboard.paste', { id: clip.id, plain: true }) },
    { title: clip.pinned ? 'Unpin' : 'Pin', shortcut: 'Command+.', stay: true, run: async () => void (await ctx.call('clipboard.pin', { id: clip.id, pinned: !clip.pinned })) },
    { title: 'Delete', shortcut: 'Command+Backspace', stay: true, run: async () => void (await ctx.call('clipboard.delete', { id: clip.id })) },
  ]
}

/** A colour clip's icon: a rounded square of the colour. */
const swatch = (color: string, side = 28) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><rect width="${side}" height="${side}" rx="${side / 4}" fill="${color}"/></svg>`)}`

/** The launcher's preview pane: the image, colour or whole text, then where and when it was copied. */
function clipPreview(clip: Clip): SearchItem['preview'] {
  const details = [
    { label: 'Kind', value: KIND[clip.kind] },
    ...(clip.kind === 'image' ? [{ label: 'Dimensions', value: clip.content }] : []),
    ...(clip.kind === 'image' && clip.detail ? [{ label: 'Size', value: clip.detail }] : []),
    ...(clip.kind === 'text' ? [{ label: 'Characters', value: clip.content.length.toLocaleString() }] : []),
    ...(clip.app ? [{ label: 'Copied in', value: clip.app }] : []),
    { label: 'Copied', value: new Date(clip.copiedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) },
  ]
  if (clip.kind === 'color') return { image: swatch(clip.content, 160), details }
  if (clip.preview) return { image: clip.preview, details }
  return { text: clip.content.length > 4000 ? `${clip.content.slice(0, 4000)}…` : clip.content, details }
}

/** Root search asks for this many characters before it shows clips: fewer match too much by chance. */
const ROOT_MIN = 3

/** Inside the scope a first word such as `image:` or `links:` keeps only clips of that kind. */
const KIND_FILTER: Record<string, Clip['kind']> = Object.fromEntries(
  (['text', 'link', 'image', 'color', 'file'] as const).flatMap((kind) => [
    [`${kind}:`, kind],
    [`${kind}s:`, kind],
  ]),
)

/**
 * Pinned clips, then the newest; every word of the query must appear. Inside the Clipboard scope that's in the clip,
 * its file name or the app it came from; in the root search only in the clip itself, so "saf" doesn't list every
 * clip copied in Safari.
 */
function search(query: string, ctx: PluginContext, root: boolean): SearchItem[] {
  if (root && query.trim().length < ROOT_MIN) return []
  let words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const kind = root ? undefined : KIND_FILTER[words[0] ?? '']
  if (kind) words = words.slice(1)
  return history
    .filter((clip) => !kind || clip.kind === kind)
    .filter((clip) => {
      const text = (root ? clip.content : `${clip.content} ${clip.detail ?? ''} ${clip.app ?? ''}`).toLowerCase()
      return words.every((w) => text.includes(w))
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.copiedAt - a.copiedAt)
    .slice(0, 50)
    .map((clip) => clipItem(clip, ctx))
}

/** The host records only while `clipboard` is subscribed, so the plugin holds it for as long as it runs. */
function activate(ctx: PluginContext) {
  let newest: number | undefined
  return ctx.subscribe('clipboard', async (state) => {
    history = state.clips
    const top = state.clips.reduce<Clip | undefined>((a, c) => (!a || c.copiedAt > a.copiedAt ? c : a), undefined)
    const fresh = top && newest !== undefined && top.copiedAt > newest
    newest = top?.copiedAt ?? newest ?? 0
    if (!fresh || ctx.island.get() === 'expanded' || !(await ctx.storage.get<boolean>(FLASH))) return
    copied.set(toClip(top))
    ctx.activity.flash({ priority: 'alert', key: 'copied', view: Copied, durationMs: 2500 })
  })
}

export default definePlugin({
  activate,
  widget: { title: 'Clipboard', icon: ClipboardList, view: Widget },
  settings: Settings,
  search: {
    title: 'Clipboard',
    icon: ClipboardList,
    keywords: ['clip', 'clipboard', 'paste'],
    root: { limit: 3 },
    // ⌘1–⌘9 paste the first nine clips.
    numberKeys: true,
    provide: (query, { ctx, root }) => search(query, ctx, root),
  },
})
