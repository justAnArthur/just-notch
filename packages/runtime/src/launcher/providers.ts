import type { CurrencyRates, FileHit, SystemAction } from '@just-notch/bridge-schema'
import type { IconProps, SearchItem } from '@just-notch/sdk'
import { AppWindow, Folder, Globe, Layers, Moon, MonitorOff, Sparkles, SunMoon, Trash2, Workflow } from 'lucide-react'
import { type ComponentType, useEffect, useState } from 'react'
import { call } from '../host/client'
import { type LoadedPlugin, usePlugins } from '../plugins/loader'
import { searchApps, useAppIndex, useFrecency } from './apps'
import { inlineAnswer } from './engines'
import { frecencyScore, rankScore } from './frecency'
import { bestScore } from './match'
import type { Row, Section } from './rows'

/** A round button beside the bar: a built-in scope or a plugin's. */
export interface Scope {
  id: string
  title: string
  icon: ComponentType<IconProps>
  plugin?: LoadedPlugin
  keywords: string[]
  /** Rows it adds to the root search; `false` only inside the scope. */
  rootLimit: number | false
}

const BUILT_IN: Scope[] = [
  { id: 'apps', title: 'Applications', icon: AppWindow, keywords: ['app', 'apps'], rootLimit: 6 },
  { id: 'files', title: 'Files', icon: Folder, keywords: ['file', 'files'], rootLimit: 5 },
  { id: 'actions', title: 'Actions', icon: Layers, keywords: ['action', 'actions'], rootLimit: 3 },
]
/** Scope buttons beside the bar; more plugin scopes are reachable by keyword only. */
export const MAX_SCOPES = 6
const SCOPE_LIMIT = 50
const FILES_DEBOUNCE_MS = 110

/** Built-in scopes, then each running plugin's, in the host's plugin order. */
export function useScopes(): Scope[] {
  const plugins = usePlugins()
  const own = plugins.flatMap((plugin): Scope[] => {
    const search = plugin.definition.search
    if (!search) return []
    const root = search.root === false ? false : (search.root?.limit ?? 3)
    return [{ id: `plugin:${plugin.installed.manifest.id}`, title: search.title, icon: search.icon ?? Sparkles, plugin, keywords: search.keywords ?? [], rootLimit: root }]
  })
  return [...BUILT_IN, ...own].slice(0, MAX_SCOPES)
}

const SYSTEM_ACTIONS: { action: SystemAction; title: string; keywords: string[]; icon: ComponentType<IconProps> }[] = [
  { action: 'sleep', title: 'Sleep', keywords: ['sleep', 'suspend'], icon: Moon },
  { action: 'displaySleep', title: 'Turn Off Display', keywords: ['display', 'lock', 'screen off'], icon: MonitorOff },
  { action: 'screenSaver', title: 'Start Screen Saver', keywords: ['screen saver', 'screensaver'], icon: Sparkles },
  { action: 'emptyTrash', title: 'Empty Trash', keywords: ['trash', 'bin'], icon: Trash2 },
  { action: 'toggleDarkMode', title: 'Toggle Dark Mode', keywords: ['dark mode', 'appearance', 'light mode'], icon: SunMoon },
]

const fileKind: Record<FileHit['kind'], string> = {
  folder: 'Folder',
  application: 'Application',
  image: 'Image',
  pdf: 'PDF',
  document: 'Document',
  other: 'File',
}

const folderOf = (path: string) => path.replace(/\/[^/]+\/?$/, '').replace(/^\/Users\/[^/]+/, '~')

/** `1.2 MB`, in the decimal units Finder uses. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function fileRow(hit: FileHit): Row {
  return {
    id: `file:${hit.path}`,
    title: hit.name,
    subtitle: folderOf(hit.path),
    icon: { path: hit.path },
    accessory: fileKind[hit.kind],
    preview: {
      thumbnail: hit.path,
      details: [
        { label: 'Kind', value: fileKind[hit.kind] },
        ...(hit.size !== undefined ? [{ label: 'Size', value: formatBytes(hit.size) }] : []),
        ...(hit.modified ? [{ label: 'Modified', value: formatDate(hit.modified) }] : []),
        { label: 'Where', value: folderOf(hit.path) },
      ],
    },
    actions: [
      { title: 'Open', run: () => void call('runtime', 'files.open', { path: hit.path }) },
      { title: 'Show in Finder', run: () => void call('runtime', 'files.reveal', { path: hit.path }) },
      { title: 'Copy Path', run: () => void call('runtime', 'clipboard.writeText', { text: hit.path }) },
    ],
  }
}

function pluginRow(scope: Scope, item: SearchItem): Row {
  const icon = typeof item.icon === 'string' ? { src: item.icon } : item.icon ? { glyph: item.icon } : { glyph: scope.icon }
  return { id: `${scope.id}:${item.id}`, title: item.title, subtitle: item.subtitle, icon, accessory: item.accessory, actions: item.actions, preview: item.preview }
}

/** Results that arrive later (files, plugin scopes), kept with the query they answer. */
function useAsync<T>(key: string, enabled: boolean, load: (signal: AbortSignal) => Promise<T>, delay = 0): T | undefined {
  const [state, setState] = useState<{ key: string; value: T }>()
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      load(controller.signal).then(
        (value) => !controller.signal.aborted && setState({ key, value }),
        () => {},
      )
    }, delay)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, enabled])
  return state?.key === key ? state.value : undefined
}

export interface SearchView {
  sections: Section[]
  /** One line instead of results: nothing found, or nothing typed in a scope that needs a query. */
  note?: string
}

/**
 * Everything the launcher shows for `query` in `scope` (root when undefined): the inline answer, apps, plugin
 * scopes, actions, files and a web search, each from its own provider.
 */
export function useSearch(query: string, scope: Scope | undefined, scopes: Scope[], open: boolean): SearchView & { record(id: string): void } {
  const apps = useAppIndex(open)
  const [frecency, record] = useFrecency()
  const [rates, setRates] = useState<CurrencyRates | null>(null)
  const [shortcuts, setShortcuts] = useState<string[]>([])
  const q = query.trim()
  const root = scope === undefined

  useEffect(() => {
    if (!open) return
    void call('runtime', 'rates.currency', {}).then(setRates, () => {})
    void call('runtime', 'actions.shortcuts', {}).then(setShortcuts, () => {})
  }, [open])

  const wantFiles = open && (scope?.id === 'files' ? q.length >= 1 : root && q.length >= 2)
  const files = useAsync(`files ${q} ${scope?.id}`, wantFiles, () => call('runtime', 'files.search', { query: q, limit: root ? 5 : SCOPE_LIMIT }), FILES_DEBOUNCE_MS)

  // Plugin scopes answer on every keystroke; the root asks only those that show there, a scope only itself.
  const asked = scopes.filter((s) => s.plugin && (scope ? s.id === scope.id : s.rootLimit !== false && q !== ''))
  const pluginKey = `${asked.map((s) => s.id).join(',')} ${q}`
  const pluginRows = useAsync(pluginKey, open && asked.length > 0, async (signal) => {
    const answers = await Promise.all(
      asked.map(async (s) => {
        try {
          const items = await s.plugin!.definition.search!.provide(q, { ctx: s.plugin!.ctx, signal, root })
          return [s.id, items.map((item) => pluginRow(s, item))] as const
        } catch {
          return [s.id, []] as const
        }
      }),
    )
    return Object.fromEntries(answers) as Record<string, Row[]>
  })

  const appRows = (limit: number): Row[] =>
    (q || !root ? (q ? searchApps(q, apps, frecency, limit) : allApps(apps)) : []).map(({ id, app }) => ({
      id,
      title: app.name,
      icon: { path: app.path },
      accessory: 'Application',
      actions: [
        { title: 'Open', run: () => void call('runtime', 'apps.launch', { path: app.path }) },
        { title: 'Show in Finder', run: () => void call('runtime', 'files.reveal', { path: app.path }) },
        { title: 'Copy Path', run: () => void call('runtime', 'clipboard.writeText', { text: app.path }) },
      ],
    }))

  const actionRows = (limit: number): Row[] => {
    const candidates: (Row & { score: number })[] = []
    for (const a of SYSTEM_ACTIONS) {
      const score = q ? bestScore(q, a.title, a.keywords) : 1
      if (score > 0)
        candidates.push({
          id: `action:${a.action}`,
          title: a.title,
          icon: { glyph: a.icon },
          accessory: 'Action',
          actions: [{ title: 'Run', run: () => void call('runtime', 'actions.system', { action: a.action }) }],
          score: rankScore(score, frecencyScore(frecency, `action:${a.action}`)),
        })
    }
    for (const name of shortcuts) {
      const score = q ? bestScore(q, name) : 1
      if (score > 0)
        candidates.push({
          id: `shortcut:${name}`,
          title: name,
          icon: { glyph: Workflow },
          accessory: 'Shortcut',
          actions: [{ title: 'Run Shortcut', run: () => void call('runtime', 'actions.runShortcut', { name }) }],
          score: rankScore(score, frecencyScore(frecency, `shortcut:${name}`)),
        })
    }
    return candidates.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  const webRow = (): Row => ({
    id: 'web',
    title: `Search the Web for “${q}”`,
    icon: { glyph: Globe },
    actions: [{ title: 'Search', run: () => void call('runtime', 'system.openUrl', { url: `https://www.google.com/search?q=${encodeURIComponent(q)}` }) }],
  })

  // Inside a scope: only its rows.
  if (scope) {
    let rows: Row[] | undefined
    if (scope.id === 'apps') rows = appRows(SCOPE_LIMIT)
    else if (scope.id === 'actions') rows = actionRows(SCOPE_LIMIT)
    else if (scope.id === 'files') {
      if (!q) return { sections: [], note: 'Type to search your files.', record }
      rows = files?.map(fileRow)
    } else rows = pluginRows?.[scope.id]
    if (!rows) return { sections: [], record }
    if (!rows.length) return { sections: [], note: q ? `Nothing in ${scope.title} matches “${q}”.` : `${scope.title} is empty.`, record }
    return { sections: [{ title: scope.title, rows }], record }
  }

  if (!q) return { sections: [], record }
  const sections: Section[] = []
  const answer = inlineAnswer(q, { rates })
  if (answer)
    sections.push({
      title: answerTitle[answer.kind],
      rows: [{ id: `answer:${answer.kind}`, title: answer.result, answer, actions: [{ title: 'Copy', run: () => void call('runtime', 'clipboard.writeText', { text: answer.copy }) }] }],
    })
  const [top, ...restApps] = appRows(BUILT_IN[0].rootLimit as number)
  if (top) sections.push({ title: answer ? 'Applications' : 'Top Hit', rows: answer ? [top, ...restApps] : [top] })
  if (top && !answer && restApps.length) sections.push({ title: 'Applications', rows: restApps })
  for (const s of asked) {
    const rows = pluginRows?.[s.id]?.slice(0, s.rootLimit || 0)
    if (rows?.length) sections.push({ title: s.title, rows })
  }
  const acts = actionRows(BUILT_IN[2].rootLimit as number)
  if (acts.length) sections.push({ title: 'Actions', rows: acts })
  if (files?.length) sections.push({ title: 'Files', rows: files.map(fileRow) })
  sections.push({ title: 'Web', rows: [webRow()] })
  return { sections, record }
}

const answerTitle = { math: 'Calculator', unit: 'Conversion', currency: 'Currency', time: 'Time', date: 'Date', base: 'Calculator' } as const

function allApps(apps: ReturnType<typeof useAppIndex>) {
  return apps.filter((a) => a.path).map((app) => ({ id: `app:${app.bundleId}`, app: { ...app, path: app.path as string }, score: 0 }))
}

/** A keyword and a space at the start of the query enter that scope: `clip `, `file `. */
export function scopeByKeyword(query: string, scopes: Scope[]): { scope: Scope; rest: string } | undefined {
  const match = /^(\S+)\s(.*)$/.exec(query)
  if (!match) return undefined
  const word = match[1].toLowerCase()
  const scope = scopes.find((s) => s.keywords.includes(word))
  return scope && { scope, rest: match[2] }
}
