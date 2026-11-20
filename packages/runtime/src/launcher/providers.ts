import type { AppInfo, CurrencyRates, FileHit, Method, Methods, SystemAction } from '@just-notch/bridge-schema'
import type { IconProps, SearchItem } from '@just-notch/sdk'
import { AppWindow, ArrowUpRight, CircleX, Lock, LogOut, Power, RotateCcw, CircleAlert, Copy, Folder, FolderSearch, Globe, Layers, Moon, MonitorOff, Play, Search, Sparkles, SunMoon, Trash2, Workflow } from 'lucide-react'
import { type ComponentType, useEffect, useState } from 'react'
import { call } from '../host/client'
import { subscribeTopic } from '../host/topics'
import { type LoadedPlugin, usePlugins } from '../plugins/loader'
import { searchApps, useAppIndex } from './apps'
import { inlineAnswer } from './engines'
import { type Frecency, frecencyScore, type Knowledge, queryBoost, rankScore } from './frecency'
import { bestScore, FUZZY_MAX, matchScore, normalize } from './match'
import { aliasedIds, fallbackUrl, type ItemSnapshot, recentIds, shownFallbacks } from './prefs'
import { type Group, rankRoot, type Scored } from './rank'
import type { Row, Section } from './rows'
import { type Source, useSources } from './sources'
import type { LauncherStore } from './store'

/** A round button beside the bar: a built-in scope or a plugin's. */
export interface Scope {
  id: string
  title: string
  icon: ComponentType<IconProps>
  plugin?: LoadedPlugin
  keywords: string[]
  /** Rows it adds to the root search; `false` only inside the scope. */
  rootLimit: number | false
  /** Inside it, ⌘1–⌘9 run the 1st–9th row instead of switching scopes. */
  numberKeys?: boolean
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
/** The empty root's Recent, under any favourites. */
const RECENT_LIMIT = 8
/** An alias typed exactly: above any match and habit. */
const ALIAS_MATCH = 5000
/** Spotlight on a cold index can take a while; past this the Files section says so. */
const FILES_TIMEOUT_MS = 2000

/** Built-in scopes, then each running plugin's, in the host's plugin order. */
export function useScopes(): Scope[] {
  const plugins = usePlugins()
  const own = plugins.flatMap((plugin): Scope[] => {
    const search = plugin.definition.search
    if (!search) return []
    const root = search.root === false ? false : (search.root?.limit ?? 3)
    return [{ id: `plugin:${plugin.installed.manifest.id}`, title: search.title, icon: search.icon ?? Sparkles, plugin, keywords: search.keywords ?? [], rootLimit: root, numberKeys: search.numberKeys }]
  })
  return [...BUILT_IN, ...own].slice(0, MAX_SCOPES)
}

const SYSTEM_ACTIONS: { action: SystemAction; title: string; keywords: string[]; icon: ComponentType<IconProps>; confirm?: string }[] = [
  { action: 'sleep', title: 'Sleep', keywords: ['sleep', 'suspend'], icon: Moon },
  { action: 'displaySleep', title: 'Turn Off Display', keywords: ['display', 'screen off'], icon: MonitorOff },
  { action: 'screenSaver', title: 'Start Screen Saver', keywords: ['screen saver', 'screensaver'], icon: Sparkles },
  { action: 'emptyTrash', title: 'Empty Trash', keywords: ['trash', 'bin'], icon: Trash2, confirm: 'Press ↩ again to empty the Trash' },
  { action: 'toggleDarkMode', title: 'Toggle Dark Mode', keywords: ['dark mode', 'appearance', 'light mode'], icon: SunMoon },
  { action: 'lockScreen', title: 'Lock Screen', keywords: ['lock'], icon: Lock },
  // macOS asks for these itself, with its own countdown and Cancel.
  { action: 'restart', title: 'Restart…', keywords: ['restart', 'reboot'], icon: RotateCcw },
  { action: 'shutDown', title: 'Shut Down…', keywords: ['shut down', 'shutdown', 'power off', 'turn off'], icon: Power },
  { action: 'logOut', title: 'Log Out…', keywords: ['log out', 'logout', 'sign out'], icon: LogOut },
  // Named after the app in front when the launcher opened: "Quit Safari".
  { action: 'quitFrontApp', title: 'Quit App', keywords: ['quit', 'close app'], icon: CircleX },
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

/** Show in Finder and Copy Path, for anything with a path. */
const pathActions = (path: string): Row['actions'] => [
  { title: 'Show in Finder', icon: FolderSearch, shortcut: 'Command+Shift+R', run: () => run('files.reveal', { path }) },
  { title: 'Copy Path', icon: Copy, shortcut: 'Command+Shift+C', run: () => run('clipboard.writeText', { text: path }) },
]

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
      { title: 'Open', icon: ArrowUpRight, run: () => run('files.open', { path: hit.path }) },
      ...pathActions(hit.path),
    ],
  }
}

function pluginRow(scope: Scope, item: SearchItem): Row {
  const icon = typeof item.icon === 'string' ? { src: item.icon } : item.icon ? { glyph: item.icon } : { glyph: scope.icon }
  return { id: `${scope.id}:${item.id}`, title: item.title, subtitle: item.subtitle, icon, accessory: item.accessory, actions: item.actions, preview: item.preview, plugin: scope.plugin?.installed.manifest.id }
}

function appRow(id: string, name: string, path: string): Row {
  return {
    id,
    title: name,
    icon: { path },
    accessory: 'Application',
    actions: [{ title: 'Open', icon: ArrowUpRight, run: () => run('apps.launch', { path }) }, ...pathActions(path)],
  }
}

function actionRow({ id, title, action, shortcut }: Pick<ActionMatch, 'id' | 'title' | 'action' | 'shortcut'>): Row {
  const system = action && SYSTEM_ACTIONS.find((a) => a.action === action)
  return {
    id,
    title,
    icon: { glyph: system?.icon ?? Workflow },
    accessory: action ? 'Action' : 'Shortcut',
    actions: [
      {
        title: 'Run',
        icon: Play,
        confirm: system?.confirm,
        run: () => (action ? run('actions.system', { action }) : run('actions.runShortcut', { name: shortcut! })),
      },
    ],
  }
}

/**
 * A kept result as a row again, without searching: for Recent, Favourites, an alias or a hotkey. A plugin's result is
 * asked of its provider again when it runs (by its title, inside its scope), since only the plugin can run it.
 */
export function rowFromSnapshot(snap: ItemSnapshot, scopes: Scope[]): Row | undefined {
  const [kind, ...rest] = snap.id.split(':')
  const key = rest.join(':')
  if (kind === 'app' && snap.path) return appRow(snap.id, snap.title, snap.path)
  if (kind === 'file' && snap.path) return { ...fileRow({ path: snap.path, name: snap.title, kind: snap.fileKind ?? 'other' }), id: snap.id }
  if (kind === 'action') {
    const system = SYSTEM_ACTIONS.find((a) => a.action === key)
    return system && actionRow({ id: snap.id, title: system.title, action: system.action })
  }
  if (kind === 'shortcut') return actionRow({ id: snap.id, title: key, shortcut: key })
  if (kind === 'plugin') {
    const scope = scopes.find((s) => snap.id.startsWith(`${s.id}:`))
    const search = scope?.plugin?.definition.search
    if (!scope || !search) return undefined
    const runFirst = async () => {
      const items = await search.provide(snap.title, { ctx: scope.plugin!.ctx, signal: new AbortController().signal, root: false })
      const item = items.find((i) => `${scope.id}:${i.id}` === snap.id)
      if (!item?.actions[0]) throw new Error(`${snap.title} is gone from ${scope.title}`)
      await item.actions[0].run()
    }
    return { id: snap.id, title: snap.title, subtitle: snap.subtitle, icon: { glyph: scope.icon }, accessory: scope.title, plugin: scope.plugin?.installed.manifest.id, actions: [{ title: 'Open', icon: ArrowUpRight, run: runFirst }] }
  }
  return undefined
}

/** A system action or a Shortcut that matches the query, best first. */
export interface ActionMatch {
  id: string
  title: string
  action?: SystemAction
  shortcut?: string
  /** How well it matches, before frecency. */
  match: number
  score: number
}

/**
 * The system actions and Shortcuts for `query` (all of them for none), best first. The root shows them only for a
 * close match, not for letters scattered through their names: "term" is Terminal's, not Toggle Dark Mode's.
 */
export function matchActions(query: string, root: boolean, shortcuts: string[], frecency: Frecency, frontApp?: string): ActionMatch[] {
  const least = root ? FUZZY_MAX + 1 : 1
  const matches: ActionMatch[] = []
  const add = (found: Omit<ActionMatch, 'match' | 'score'>, match: number) => {
    if (match >= least) matches.push({ ...found, match, score: rankScore(match, frecencyScore(frecency, found.id)) })
  }
  for (const a of SYSTEM_ACTIONS) {
    // Quit needs an app in front to name and quit.
    if (a.action === 'quitFrontApp' && !frontApp) continue
    const title = a.action === 'quitFrontApp' ? `Quit ${frontApp}` : a.title
    add({ id: `action:${a.action}`, title, action: a.action }, query ? bestScore(query, title, a.keywords) : least)
  }
  for (const name of shortcuts) add({ id: `shortcut:${name}`, title: name, shortcut: name }, query ? bestScore(query, name) : least)
  return matches.sort((a, b) => b.score - a.score)
}

export interface SearchView {
  sections: Section[]
  /** One line instead of results: nothing found, or nothing typed in a scope that needs a query. */
  note?: string
  /** A provider is still answering the current query. */
  loading: boolean
  /** Remembers that the row was picked for what's typed now. */
  record(row: Row): void
  /** Asks the providers again, after an action that changed their results (Pin, Delete). */
  refresh(): void
}

/** How long a slow provider gets before its section says so, and how long a network one waits for typing to pause. */
const TIMEOUT_MS = 800
const NET_DEBOUNCE_MS = 150
/** What a provider's row scores when the provider matched it on something the name doesn't show (a clip's text). */
const PROVIDER_MATCH = 400

/** A failed or slow provider's one row, in its own section: muted, with Retry. */
function errorRow(id: string, title: string, error: 'failed' | 'timeout', net: boolean, retry: () => void): Row {
  return {
    id: `error:${id}`,
    title: error === 'timeout' ? `${title} took too long` : net ? `Couldn't reach ${title}` : `${title} didn't answer`,
    icon: { glyph: CircleAlert },
    failed: true,
    actions: [{ title: 'Retry', run: retry, stay: true }],
  }
}

/**
 * Everything the launcher shows for `query` in `scope` (root when undefined): the inline answer, apps, plugin
 * scopes, actions, files and a web search, each from its own provider. The root ranks them as one list (rank.ts).
 */
export function useSearch(query: string, scope: Scope | undefined, scopes: Scope[], open: boolean, store: LauncherStore): SearchView {
  const apps = useAppIndex(open)
  const { frecency, knowledge, prefs, snapshots } = store
  const [rates, setRates] = useState<CurrencyRates | null>(null)
  const [shortcuts, setShortcuts] = useState<string[]>([])
  const [frontApp, setFrontApp] = useState<string>()
  const q = query.trim()
  const known = normalize(q)
  const root = scope === undefined
  const record = (row: Row) => store.launched(row, known)

  useEffect(() => {
    if (!open) return
    void call('runtime', 'rates.currency', {}).then(setRates, () => {})
    void call('runtime', 'actions.shortcuts', {}).then(setShortcuts, () => {})
    return subscribeTopic('frontApp', (app) => setFrontApp(app?.name))
  }, [open])

  // Files and plugin scopes answer later. The root asks the plugins that show there, a scope only itself.
  const wantFiles = open && (scope?.id === 'files' ? q.length >= 1 : root && q.length >= 2)
  const asked = open ? scopes.filter((s) => s.plugin && (scope ? s.id === scope.id : s.rootLimit !== false && q !== '')) : []
  const net = (s: Scope) => s.plugin!.installed.manifest.permissions.includes('net')
  const sources: Source<Row[]>[] = [
    ...(wantFiles
      ? [{ id: 'files', key: `${q} ${scope?.id}`, debounce: FILES_DEBOUNCE_MS, timeout: FILES_TIMEOUT_MS, load: async () => (await call('runtime', 'files.search', { query: q, limit: root ? 5 : SCOPE_LIMIT })).map(fileRow) }]
      : []),
    ...asked.map((s) => {
      const search = s.plugin!.definition.search!
      return {
        id: s.id,
        key: `${q} ${root}`,
        debounce: search.debounce ?? (net(s) ? NET_DEBOUNCE_MS : 0),
        timeout: search.timeout ?? TIMEOUT_MS,
        load: async (signal: AbortSignal) => (await search.provide(q, { ctx: s.plugin!.ctx, signal, root })).map((item) => pluginRow(s, item)),
      }
    }),
  ]
  const { views, retry } = useSources(sources)
  const loading = sources.some((s) => views[s.id].pending)
  const state = { loading, record, refresh: retry }
  /** A source's rows, or its error row once it failed. */
  const rowsOf = (id: string, title: string, isNet = false): { rows?: Row[]; failed?: boolean } => {
    const view = views[id]
    if (!view) return {}
    if (view.error) return { rows: [errorRow(id, title, view.error, isNet, retry)], failed: true }
    return { rows: view.value }
  }

  const appResults = (limit: number) => (q ? searchApps(q, apps, frecency, limit) : root ? [] : allApps(apps))
  const actionResults = (limit: number) => matchActions(q, root, shortcuts, {}, frontApp).slice(0, limit)
  const fallbackRows = (others: boolean): Row[] =>
    shownFallbacks(prefs.fallbacks, others).map((f) => ({
      id: `fallback:${f.id}`,
      title: `Search ${f.title} for “${q}”`,
      icon: { glyph: f.builtIn ? Globe : Search },
      actions: [{ title: 'Search', icon: ArrowUpRight, run: () => run('system.openUrl', { url: fallbackUrl(f, q) }) }],
    }))
  const kept = (ids: string[]) => ids.flatMap((id) => (snapshots[id] ? (rowFromSnapshot(snapshots[id], scopes) ?? []) : []))

  // Inside a scope: only its rows, in the provider's order, lifted by what was picked for this query before.
  if (scope) {
    let rows: Row[] | undefined
    let failed = false
    if (scope.id === 'apps') rows = appResults(SCOPE_LIMIT).map((r) => appRow(r.id, r.app.name, r.app.path))
    else if (scope.id === 'actions') rows = matchActions(q, false, shortcuts, frecency, frontApp).slice(0, SCOPE_LIMIT).map(actionRow)
    else if (scope.id === 'files' && !q) return { sections: [], note: 'Type to search your files.', ...state }
    else ({ rows, failed = false } = rowsOf(scope.id === 'files' ? 'files' : scope.id, scope.title, scope.plugin ? net(scope) : false))
    if (!rows) return { sections: [], ...state }
    if (!rows.length) return { sections: [], note: q ? `Nothing in ${scope.title} matches “${q}”.` : `${scope.title} is empty.`, ...state }
    if (!failed && known) rows = liftKnown(rows, known, knowledge)
    return { sections: [{ title: scope.title, rows }], ...state }
  }

  // The empty root: favourites, then the results used most lately.
  if (!q) {
    const favourites = kept(prefs.favourites)
    const recent = kept(recentIds(frecency, snapshots, prefs.favourites)).slice(0, RECENT_LIMIT)
    return {
      sections: [...(favourites.length ? [{ title: 'Favourites', rows: favourites }] : []), ...(recent.length ? [{ title: 'Recent', rows: recent }] : [])],
      ...state,
    }
  }
  const answer = inlineAnswer(q, { rates })
  const groups: Group[] = [
    // A result whose alias is what's typed outranks everything.
    { title: 'Alias', rows: kept(aliasedIds(prefs, q)).map((row): Scored => ({ row, match: ALIAS_MATCH })) },
    { title: 'Applications', rows: appResults(BUILT_IN[0].rootLimit as number).map((r) => ({ row: appRow(r.id, r.app.name, r.app.path), match: r.match })) },
    { title: 'Actions', rows: actionResults(BUILT_IN[2].rootLimit as number).map((a) => ({ row: actionRow(a), match: a.match })) },
  ]
  const files = rowsOf('files', 'Files')
  if (files.rows) groups.push({ title: 'Files', failed: files.failed, rows: files.rows.map((row) => ({ row, match: files.failed ? 0 : matchScore(q, row.title) || PROVIDER_MATCH })) })
  for (const s of asked) {
    const found = rowsOf(s.id, s.title, net(s))
    const rows = found.failed ? found.rows : found.rows?.slice(0, s.rootLimit || 0)
    if (rows?.length) groups.push({ title: s.title, failed: found.failed, rows: rows.map((row) => ({ row, match: found.failed ? 0 : bestScore(q, row.title) || PROVIDER_MATCH })) })
  }
  const sections = rankRoot({
    query: known,
    groups,
    frecency,
    knowledge,
    web: fallbackRows(groups.some((g) => g.rows.length) || answer !== null),
    answer: answer ? {
      title: answerTitle[answer.kind],
      rows: [{ id: `answer:${answer.kind}`, title: answer.result, answer, actions: [{ title: 'Copy', run: () => run('clipboard.writeText', { text: answer.copy }) }] }],
    } : undefined,
  })
  return { sections, ...state }
}

/** Calls the host for a row's action, so a failure reaches the launcher (which shows it) instead of vanishing. */
async function run<M extends Method>(method: M, params: Methods[M]['params']): Promise<void> {
  await call('runtime', method, params)
}

/** Inside a scope: rows picked for this query before move up, the rest keep the provider's order. */
function liftKnown(rows: Row[], query: string, knowledge: Knowledge): Row[] {
  const boost = new Map(rows.map((row) => [row, queryBoost(knowledge, query, row.id)]))
  return [...rows].sort((a, b) => boost.get(b)! - boost.get(a)!)
}

const answerTitle = { math: 'Calculator', unit: 'Conversion', currency: 'Currency', time: 'Time', date: 'Date', base: 'Calculator' } as const

function allApps(apps: ReturnType<typeof useAppIndex>) {
  return apps.filter((a) => a.path).map((app) => ({ id: `app:${app.bundleId}`, app: { ...app, path: app.path as string }, match: 0, score: 0 }))
}

/** A keyword and a space at the start of the query enter that scope: `clip `, `file `. */
export function scopeByKeyword(query: string, scopes: Scope[]): { scope: Scope; rest: string } | undefined {
  const match = /^(\S+)\s(.*)$/.exec(query)
  if (!match) return undefined
  const word = match[1].toLowerCase()
  const scope = scopes.find((s) => s.keywords.includes(word))
  return scope && { scope, rest: match[2] }
}
