import { Button, Combobox, Kbd, List } from '@justanarthur/modo-ui'
import { type AppInfo, SwitchRow, type TilingSettings, usePlugin, useStorage } from '@just-notch/sdk'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { bindings, type Command, COMMANDS } from './commands'
import { pause, problems, STORAGE } from './hotkeys'
import { acceleratorOf, formatAccelerator, reservedBy } from './shortcut'
import { DESKTOP_SETTINGS, TILING_DETAIL, TILING_TITLE, tilingOn } from './tiling'

type Overrides = Record<string, string | null>

/** Records the next shortcut pressed: Escape cancels, ⌫ on its own clears it. */
function Recorder({ title, value, onChange }: { title: string; value: string | null; onChange: (accelerator: string | null) => void }) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!active) return
    pause('recording', true)
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const bare = !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
      if (bare && event.key === 'Escape') return setActive(false)
      if (bare && event.key === 'Backspace') {
        setActive(false)
        return onChange(null)
      }
      const accelerator = acceleratorOf(event)
      if (!accelerator) return
      setActive(false)
      onChange(accelerator)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      pause('recording', false)
    }
  }, [active])

  return (
    <Button variant="secondary" size="compact" aria-label={`Change the shortcut for ${title}`} onClick={() => setActive(!active)} onBlur={() => setActive(false)}>
      {active ? 'Press a shortcut…' : value ? <Kbd variant="plain">{formatAccelerator(value)}</Kbd> : 'None'}
    </Button>
  )
}

function CommandRow({ command, value, problem, onChange }: { command: Command; value: string | null; problem?: string; onChange: (accelerator: string | null) => void }) {
  const reserved = value && reservedBy(value)
  const description = problem ?? (reserved ? `macOS keeps this for ${reserved}` : undefined)
  return (
    <List.Row label={command.title} description={description}>
      <div className="flex items-center gap-1">
        <Recorder title={command.title} value={value} onChange={onChange} />
        {value && (
          <Button variant="ghost" size="icon-compact" aria-label={`Clear the shortcut for ${command.title}`} onClick={() => onChange(null)}>
            <X />
          </Button>
        )}
      </div>
    </List.Row>
  )
}

function AppLabel({ app }: { app: AppInfo }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {app.icon && <img src={app.icon} alt="" className="size-4 shrink-0" />}
      <span className="truncate">{app.name}</span>
    </span>
  )
}

/** Apps whose own ⌃⌥ shortcuts win: while one is in front, the hotkeys step aside. */
function IgnoredApps() {
  const { call } = usePlugin()
  const [ignored, setIgnored] = useStorage<string[]>(STORAGE.ignoredApps, [])
  const [apps, setApps] = useState<AppInfo[]>([])
  const [query, setQuery] = useState('')
  useEffect(() => {
    call('apps.list', {}).then(setApps, () => {})
  }, [call])

  const byId = new Map(apps.map((app) => [app.bundleId, app]))
  const items = apps.filter((app) => !ignored.includes(app.bundleId)).map((app) => ({ value: app.bundleId, label: <AppLabel app={app} />, textValue: app.name }))
  const add = (id: string) => {
    setQuery('')
    if (id && !ignored.includes(id)) setIgnored([...ignored, id])
  }

  return (
    <List.Section title="Ignore in" aside={`${ignored.length} ${ignored.length === 1 ? 'app' : 'apps'}`}>
      {ignored.map((id) => (
        <List.Row key={id} label={<AppLabel app={byId.get(id) ?? { bundleId: id, name: id }} />}>
          <Button variant="ghost" size="icon-compact" aria-label={`Remove ${byId.get(id)?.name ?? id}`} onClick={() => setIgnored(ignored.filter((a) => a !== id))}>
            <X />
          </Button>
        </List.Row>
      ))}
      <List.Row label="Add an app" description="While it's in front, its own ⌃⌥ shortcuts work instead (an IDE, a terminal).">
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

/** Settings › Window Management: the master switch, cycling, and every command's rebindable shortcut. */
export default function Settings() {
  const [enabled, setEnabled] = useStorage(STORAGE.enabled, true)
  const [cycling, setCycling] = useStorage(STORAGE.cycling, true)
  const [animate, setAnimate] = useStorage(STORAGE.animate, true)
  const { call } = usePlugin()
  const [tiling, setTiling] = useState<TilingSettings>()
  useEffect(() => {
    call('windows.tiling', {}).then(setTiling, () => {})
  }, [call])
  const [overrides, setOverrides] = useStorage<Overrides>(STORAGE.bindings, {})
  const issues = problems.use()
  const bound = bindings(overrides)
  const changed = Object.keys(overrides).length > 0
  const conflicts = COMMANDS.filter((c) => issues[c.id] || reservedBy(bound.get(c.id) ?? '')).length

  const bind = (command: Command, accelerator: string | null) => {
    const next = { ...overrides }
    if (accelerator === command.accelerator) delete next[command.id]
    else next[command.id] = accelerator
    setOverrides(next)
  }

  return (
    <List>
      <List.Section title="Hotkeys">
        <SwitchRow
          label="Window hotkeys"
          description="Move the front window from any app with ⌃⌥ and a key, as in Rectangle."
          checked={enabled}
          onCheckedChange={setEnabled}
        />
        <SwitchRow
          label="Repeat to cycle"
          description="Press a half again for two thirds, then one third. Thirds step along the screen."
          checked={cycling}
          onCheckedChange={setCycling}
        />
        <SwitchRow label="Animate moves" description="Windows glide into place. Off while Reduce Motion is on." checked={animate} onCheckedChange={setAnimate} />
        {tiling && tilingOn(tiling) && (
          <List.Row label={TILING_TITLE} description={TILING_DETAIL}>
            <Button variant="secondary" size="compact" onClick={() => void call('system.openUrl', { url: DESKTOP_SETTINGS })}>
              Open Desktop & Dock
            </Button>
          </List.Row>
        )}
      </List.Section>
      {enabled && (
        <List.Section title="Shortcuts" aside={conflicts ? `${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'}` : undefined}>
          {COMMANDS.map((command) => (
            <CommandRow key={command.id} command={command} value={bound.get(command.id) ?? null} problem={issues[command.id]} onChange={(a) => bind(command, a)} />
          ))}
          <List.Row label="Defaults" description="Rectangle's ⌃⌥ layout.">
            <Button variant="secondary" size="compact" disabled={!changed} onClick={() => setOverrides({})}>
              Reset All
            </Button>
          </List.Row>
        </List.Section>
      )}
      {enabled && <IgnoredApps />}
    </List>
  )
}
