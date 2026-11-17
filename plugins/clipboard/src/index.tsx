import { type ClipboardClip, ClipboardHistory } from '@justanarthur/modo-ui-notch'
import { Button, Input, List } from '@justanarthur/modo-ui'
import { type Clip, definePlugin, type PluginContext, signal, SwitchRow, usePlugin, useSheet, useStorage, useTopic } from '@just-notch/sdk'
import { ClipboardList, X } from 'lucide-react'
import { useState } from 'react'

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

function IgnoredApps() {
  const { call } = usePlugin()
  const ignored = useTopic('clipboard')?.ignoredApps ?? []
  const [draft, setDraft] = useState('')
  const set = (apps: string[]) => void call('clipboard.setIgnoredApps', { apps })
  const add = () => {
    const id = draft.trim()
    if (!id || ignored.includes(id)) return
    set([...ignored, id])
    setDraft('')
  }
  return (
    <List.Section title="Never record from" aside={`${ignored.length} apps`}>
      {ignored.map((app) => (
        <List.Row key={app} label={app}>
          <Button variant="ghost" size="icon" aria-label={`Remove ${app}`} onClick={() => set(ignored.filter((a) => a !== app))}>
            <X />
          </Button>
        </List.Row>
      ))}
      <List.Row label="Add an app" description="Its bundle id, such as com.1password.1password. Concealed copies are always skipped.">
        <Input
          aria-label="Bundle id"
          value={draft}
          placeholder="com.example.app"
          className="w-56"
          onValueChange={setDraft}
          onKeyDown={(event) => event.key === 'Enter' && add()}
          onBlur={add}
        />
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
        <List.Row label="Clear history" description="Pinned clips are kept.">
          <Button variant="secondary" size="compact" onClick={() => void call('clipboard.clear', {})}>
            Clear
          </Button>
        </List.Row>
      </List.Section>
      <IgnoredApps />
    </List>
  )
}

/** The host records only while `clipboard` is subscribed, so the plugin holds it for as long as it runs. */
function activate(ctx: PluginContext) {
  let newest: number | undefined
  return ctx.subscribe('clipboard', async (state) => {
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
})
