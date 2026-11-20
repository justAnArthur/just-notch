import type { AppPreferences, Methods } from '@just-notch/bridge-schema'
import { Button, Input, Kbd, List, Switch } from '@justanarthur/modo-ui'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { SwitchRow } from '@just-notch/sdk'
import { useEffect, useState } from 'react'
import { call } from '../host/client'
import { useStored } from '../launcher/apps'
import { PROBLEMS_KEY } from '../launcher/hotkeys'
import { conflicts, type Fallback, moveItem, orderedSections, quicklinkProblem } from '../launcher/prefs'
import { rootSources, useScopes } from '../launcher/providers'
import { tryLauncher } from '../launcher/state'
import { acceleratorOf, formatAccelerator } from '../launcher/shortcut'
import { type LauncherStore, useLauncherStore } from '../launcher/store'

export type PreferenceChange = Methods['app.setPreferences']['params']

/** Spotlight's shortcut lives in Keyboard › Keyboard Shortcuts › Spotlight. */
const KEYBOARD_SHORTCUTS = 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension'

/** A button that records the next shortcut pressed; Escape cancels. */
function ShortcutRecorder({ value, onChange }: { value: string | undefined; onChange: (accelerator: string) => void }) {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape' && !event.metaKey && !event.altKey && !event.ctrlKey) return setRecording(false)
      const accelerator = acceleratorOf(event)
      if (!accelerator) return
      setRecording(false)
      onChange(accelerator)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  return (
    <Button variant="secondary" size="compact" aria-label="Change shortcut" onClick={() => setRecording(!recording)} onBlur={() => setRecording(false)}>
      {recording ? 'Press a shortcut…' : value ? <Kbd variant="plain">{formatAccelerator(value)}</Kbd> : 'Record Hotkey'}
    </Button>
  )
}

interface LauncherPageProps {
  preferences: AppPreferences | undefined
  error: string | undefined
  onChange: (change: PreferenceChange) => void
}

/**
 * Settings › Launcher: on or off and its hotkey, then what was set from ⌘K (aliases and hotkeys, with conflicts),
 * the fallback searches and their order, and the ranking it learned.
 */
export default function LauncherPage({ preferences, error, onChange }: LauncherPageProps) {
  const store = useLauncherStore()
  if (!preferences) return null
  const { launcher } = preferences
  const shortcut = formatAccelerator(launcher.shortcut)

  return (
    <List>
      <List.Section title="Launcher">
        <SwitchRow
          label="Open with a hotkey"
          description="Search drops out of the notch. Esc or a click outside closes it."
          checked={launcher.enabled}
          onCheckedChange={(enabled) => onChange({ launcher: { enabled } })}
        />
        <List.Row label="Hotkey" description="Click, then press the keys. It needs ⌘, ⌥, ⌃ or ⇧, unless it's a function key.">
          <ShortcutRecorder value={launcher.shortcut} onChange={(next) => onChange({ launcher: { shortcut: next } })} />
        </List.Row>
        <List.Row label="Try it" description={`Or press ${shortcut} anywhere.`}>
          <Button variant="secondary" size="compact" onClick={() => tryLauncher()}>
            Open Launcher
          </Button>
        </List.Row>
        {error && <List.Row label="That hotkey didn't work" description={error} />}
        {launcher.enabled && !launcher.active && !error && (
          <List.Row label={`${shortcut} isn't available`} description="Another app uses it. Pick another hotkey." />
        )}
        {launcher.spotlightConflict && (
          <List.Row
            label={`Spotlight still uses ${shortcut}`}
            description="Turn off Show Spotlight search in Keyboard Shortcuts › Spotlight, and the launcher gets it."
          >
            <Button variant="secondary" size="compact" onClick={() => void call('runtime', 'system.openUrl', { url: KEYBOARD_SHORTCUTS })}>
              Open Keyboard Shortcuts
            </Button>
          </List.Row>
        )}
      </List.Section>
      <RootSources store={store} />
      <Excludes store={store} />
      <AliasesAndHotkeys store={store} launcherHotkey={launcher.shortcut} />
      <Fallbacks store={store} />
      <List.Section title="Ranking">
        <List.Row label="Reset ranking" description="Forget which results you open most and what you pick for what you type. Favourites, aliases and hotkeys stay.">
          <Button variant="secondary" size="compact" onClick={() => store.resetAll()}>
            Reset
          </Button>
        </List.Row>
      </List.Section>
    </List>
  )
}

/** What the root search shows: each source on or off, in an order that breaks ties between equally good results. */
function RootSources({ store }: { store: LauncherStore }) {
  const sources = rootSources(useScopes())
  const sections = orderedSections(store.prefs.sections, sources.map((s) => s.id))
  const title = (id: string) => sources.find((s) => s.id === id)?.title ?? id
  const save = (next: typeof sections) => store.update((prefs) => ({ ...prefs, sections: next }))
  return (
    <List.Section title="Root search">
      <p className="px-3 text-caption text-muted-foreground">The best result from any of them comes first; between two as good, the higher source wins. A source turned off still answers inside its own scope.</p>
      {sections.map((section, i) => (
        <List.Row key={section.id} label={title(section.id)}>
          <span className="flex items-center gap-1">
            <Button variant="ghost" size="icon-compact" aria-label={`Move ${title(section.id)} up`} disabled={i === 0} onClick={() => save(moveItem(sections, i, -1))}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-compact" aria-label={`Move ${title(section.id)} down`} disabled={i === sections.length - 1} onClick={() => save(moveItem(sections, i, 1))}>
              <ArrowDown />
            </Button>
            <Switch aria-label={`Show ${title(section.id)}`} checked={section.enabled} onCheckedChange={(enabled) => save(sections.map((x) => (x.id === section.id ? { ...x, enabled } : x)))} />
          </span>
        </List.Row>
      ))}
    </List.Section>
  )
}

/** Folders whose files never show in the launcher. */
function Excludes({ store }: { store: LauncherStore }) {
  const [folder, setFolder] = useState('')
  const excludes = store.prefs.excludes
  const save = (next: string[]) => store.update((prefs) => ({ ...prefs, excludes: next }))
  const add = () => {
    const path = folder.trim().replace(/\/+$/, '')
    if (!path || excludes.includes(path)) return
    save([...excludes, path])
    setFolder('')
  }
  return (
    <List.Section title="Files">
      {excludes.map((path) => (
        <List.Row key={path} label={path}>
          <Button variant="ghost" size="icon-compact" aria-label={`Show files in ${path} again`} onClick={() => save(excludes.filter((p) => p !== path))}>
            <X />
          </Button>
        </List.Row>
      ))}
      <List.Row label="Hide a folder" description="Its files and everything inside never show: ~/Library, a build folder.">
        <span className="flex items-center gap-2">
          <Input aria-label="Folder to hide" value={folder} placeholder="~/Library" className="w-56" onValueChange={setFolder} onKeyDown={(event) => event.key === 'Enter' && add()} />
          <Button variant="secondary" size="compact" onClick={add}>
            Hide
          </Button>
        </span>
      </List.Row>
    </List.Section>
  )
}

/** Every alias and hotkey set from ⌘K, with what's wrong with each; hotkeys can be changed here too. */
function AliasesAndHotkeys({ store, launcherHotkey }: { store: LauncherStore; launcherHotkey: string }) {
  const [taken] = useStored<Record<string, string>>(PROBLEMS_KEY)
  const titles = Object.fromEntries(Object.entries(store.snapshots).map(([id, s]) => [id, s.title]))
  const problems = conflicts(store.prefs, titles, launcherHotkey, taken)
  const items = Object.entries(store.prefs.items)
  const set = (id: string, change: { alias?: string; hotkey?: string }) =>
    store.update((prefs) => {
      const item = Object.fromEntries(Object.entries({ ...prefs.items[id], ...change }).filter(([, v]) => v !== undefined))
      const { [id]: _, ...others } = prefs.items
      return { ...prefs, items: Object.keys(item).length ? { ...others, [id]: item } : others }
    })
  return (
    <List.Section title="Aliases & Hotkeys">
      {items.length === 0 && <List.Row label="None yet" description="In the launcher, select a result and press ⌘K: Add Alias… or Assign Hotkey…" />}
      {items.map(([id, item]) => (
        <List.Row
          key={id}
          label={titles[id] ?? id}
          description={[item.alias && `Alias “${item.alias}”`, problems[id] && `⚠ ${problems[id]}`].filter(Boolean).join(' · ') || undefined}
        >
          <span className="flex items-center gap-2">
            <ShortcutRecorder value={item.hotkey} onChange={(hotkey) => set(id, { hotkey })} />
            <Button variant="ghost" size="icon-compact" aria-label={`Remove alias and hotkey of ${titles[id] ?? id}`} onClick={() => set(id, { alias: undefined, hotkey: undefined })}>
              <X />
            </Button>
          </span>
        </List.Row>
      ))}
    </List.Section>
  )
}

/** The searches the root offers last: built-in engines and quicklinks, each on or off, in the user's order. */
function Fallbacks({ store }: { store: LauncherStore }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [tried, setTried] = useState(false)
  const fallbacks = store.prefs.fallbacks
  const save = (next: Fallback[]) => store.update((prefs) => ({ ...prefs, fallbacks: next }))
  const problem = !name.trim() ? 'Give it a name.' : quicklinkProblem(url)
  const add = () => {
    setTried(true)
    if (problem) return
    save([...fallbacks, { id: `quicklink-${Date.now()}`, title: name.trim(), url: url.trim(), enabled: true }])
    setName('')
    setUrl('')
    setTried(false)
  }
  return (
    <List.Section title="Fallback searches">
      <p className="px-3 text-caption text-muted-foreground">Last in every search: the first one beside other results, the first three when nothing else matches.</p>
      {fallbacks.map((f, i) => (
        <List.Row key={f.id} label={f.title} description={f.url}>
          <span className="flex items-center gap-1">
            <Button variant="ghost" size="icon-compact" aria-label={`Move ${f.title} up`} disabled={i === 0} onClick={() => save(moveItem(fallbacks, i, -1))}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-compact" aria-label={`Move ${f.title} down`} disabled={i === fallbacks.length - 1} onClick={() => save(moveItem(fallbacks, i, 1))}>
              <ArrowDown />
            </Button>
            {!f.builtIn && (
              <Button variant="ghost" size="icon-compact" aria-label={`Delete ${f.title}`} onClick={() => save(fallbacks.filter((x) => x.id !== f.id))}>
                <X />
              </Button>
            )}
            <Switch aria-label={`Use ${f.title}`} checked={f.enabled} onCheckedChange={(enabled) => save(fallbacks.map((x) => (x.id === f.id ? { ...x, enabled } : x)))} />
          </span>
        </List.Row>
      ))}
      <List.Row label="Add a quicklink" description={tried && problem ? problem : 'Any search page: put {query} where the search goes.'}>
        <span className="flex items-center gap-2">
          <Input aria-label="Quicklink name" value={name} placeholder="GitHub" className="w-28" onValueChange={setName} />
          <Input
            aria-label="Quicklink URL"
            value={url}
            placeholder="https://github.com/search?q={query}"
            className="w-64"
            invalid={tried && !!problem}
            onValueChange={setUrl}
            onKeyDown={(event) => event.key === 'Enter' && add()}
          />
          <Button variant="secondary" size="compact" onClick={add}>
            Add
          </Button>
        </span>
      </List.Row>
    </List.Section>
  )
}
