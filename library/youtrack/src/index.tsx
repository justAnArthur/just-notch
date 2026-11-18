import { Widget } from '@justanarthur/modo-ui-notch'
import { Button, Input, List, ScrollArea, Spinner, Tabs } from '@justanarthur/modo-ui'
import { definePlugin, usePlugin, useSecret, useSheet, useStorage } from '@just-notch/sdk'
import { ExternalLink, KeyRound, Link, ListChecks, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Connection, searchIssues, type SearchResult } from './api'
import { DEFAULT_SEARCHES, ERROR_TEXT, type Issue, normalizeBaseUrl, type SavedSearch, searchUrl } from './youtrack'

const BASE_URL = 'baseUrl'
const TOKEN = 'token'
const SEARCHES = 'searches'
const TAB = 'tab'
const ADHOC = 'search'
/** Enough for a tall sheet; YouTrack's own search is one click away for the rest. */
const TOP = 50
/** What fits the short island under the search bar. */
const FIT_ROWS = 3

/** `undefined` while the token loads from the Keychain, `null` when there's nothing to connect with. */
function useConnection(): Connection | null | undefined {
  const [baseUrl] = useStorage(BASE_URL, '')
  const [token, , loading] = useSecret(TOKEN)
  if (loading) return undefined
  const base = normalizeBaseUrl(baseUrl)
  return base && token ? { baseUrl: base, token } : null
}

function useIssues(connection: Connection | null | undefined, query: string, refresh: number) {
  const { fetch } = usePlugin()
  const [result, setResult] = useState<SearchResult>()
  const key = connection && `${connection.baseUrl} ${connection.token}`
  useEffect(() => {
    if (!connection) return
    let live = true
    setResult(undefined)
    void searchIssues(fetch, connection, query, TOP).then((next) => live && setResult(next))
    return () => {
      live = false
    }
  }, [key, query, refresh])
  return result
}

function IssueRow({ issue }: { issue: Issue }) {
  const { call } = usePlugin()
  return (
    <button
      type="button"
      className="-mx-2 block rounded-md px-2 text-left hover:bg-hover focus-visible:bg-hover outline-none"
      onClick={() => void call('system.openUrl', { url: issue.url })}
    >
      <Widget.Row
        color={issue.stateColor}
        trailing={
          <>
            {issue.priority && <span>{issue.priority}</span>}
            {issue.state && <Widget.Chip>{issue.state}</Widget.Chip>}
            <span className="w-24 truncate text-right">{issue.assignee ?? 'Unassigned'}</span>
          </>
        }
      >
        <span className="mr-2 tabular-nums text-muted-foreground">{issue.id}</span>
        {issue.summary}
      </Widget.Row>
    </button>
  )
}

function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner />
    </div>
  )
}

/** Asks for the host again (a self-hosted instance the user hasn't allowed yet), then searches again. */
function AllowHost({ baseUrl, onAllowed }: { baseUrl: string; onAllowed: () => void }) {
  const { net } = usePlugin()
  return (
    <Button
      variant="secondary"
      size="compact"
      onClick={() => void net.requestHost(baseUrl, 'Your YouTrack server').then((allowed) => allowed && onAllowed())}
    >
      Allow access
    </Button>
  )
}

interface ResultsProps {
  result: SearchResult | undefined
  label: string
  baseUrl: string
  onOpen: () => void
  onRetry: () => void
}

function Results({ result, label, baseUrl, onOpen, onRetry }: ResultsProps) {
  const tall = useSheet() === 'tall'
  if (!result) return <Loading />
  if ('error' in result)
    return (
      <Widget.Message
        icon={KeyRound}
        {...ERROR_TEXT[result.error]}
        actions={result.error === 'network' && <AllowHost baseUrl={baseUrl} onAllowed={onRetry} />}
      />
    )
  if (!result.issues.length) return <Widget.Message icon={ListChecks} title="No issues" description="Nothing matches this search." />

  const shown = tall ? result.issues : result.issues.slice(0, FIT_ROWS)
  const more = result.issues.length - shown.length
  const count = result.issues.length >= TOP ? `${TOP}+` : String(result.issues.length)
  return (
    <Widget.Section
      label={label}
      trailing={
        <button type="button" className="hover:text-foreground" onClick={onOpen}>
          {more > 0 ? `${more} more` : count}
        </button>
      }
      className="min-h-0 flex-1"
    >
      {tall ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col">{shown.map((issue) => <IssueRow key={issue.id} issue={issue} />)}</div>
        </ScrollArea>
      ) : (
        shown.map((issue) => <IssueRow key={issue.id} issue={issue} />)
      )}
    </Widget.Section>
  )
}

function Issues() {
  const { call } = usePlugin()
  const connection = useConnection()
  const [searches] = useStorage<SavedSearch[]>(SEARCHES, DEFAULT_SEARCHES)
  const [tab, setTab] = useStorage(TAB, '0')
  const [draft, setDraft] = useState('')
  const [adhoc, setAdhoc] = useState<string>()
  const [refresh, setRefresh] = useState(0)

  const saved = searches[Number(tab)] ?? searches[0]
  const active = tab === ADHOC && adhoc !== undefined ? { name: 'Search', query: adhoc } : saved ?? { name: 'All issues', query: '' }
  const result = useIssues(connection, active.query, refresh)

  if (connection === undefined) return <Loading />
  if (!connection)
    return (
      <Widget.Message
        icon={Link}
        title="Connect YouTrack"
        description="Add your instance URL and a permanent token in Settings › YouTrack."
      />
    )

  const open = () => void call('system.openUrl', { url: searchUrl(connection.baseUrl, active.query) })
  const retry = () => setRefresh((n) => n + 1)
  const submit = () => {
    const query = draft.trim()
    if (!query) return
    setAdhoc(query)
    setTab(ADHOC)
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Tabs variant="subtle" size="compact" value={tab === ADHOC && adhoc === undefined ? '0' : tab} onValueChange={setTab} className="min-w-0">
          <Tabs.List>
            {searches.map((search, index) => (
              <Tabs.Item key={index} value={String(index)} label={search.name} />
            ))}
            {adhoc !== undefined && <Tabs.Item value={ADHOC} label="Search" />}
          </Tabs.List>
        </Tabs>
        <Input
          aria-label="YouTrack query"
          icon={Search}
          size="compact"
          placeholder="project: APP #Unresolved"
          value={draft}
          className="min-w-0 flex-1"
          onValueChange={setDraft}
          onKeyDown={(event) => event.key === 'Enter' && submit()}
        />
        <Widget.Action icon={RefreshCw} label="Refresh" onClick={retry} />
        <Widget.Action icon={ExternalLink} label="Open in YouTrack" onClick={open} />
      </div>
      <Results result={result} label={active.query || 'All issues'} baseUrl={connection.baseUrl} onOpen={open} onRetry={retry} />
    </div>
  )
}

function ConnectionSettings() {
  const { net } = usePlugin()
  const [baseUrl, setBaseUrl] = useStorage(BASE_URL, '')
  const [token, setToken] = useSecret(TOKEN)
  const [url, setUrl] = useState(baseUrl)
  const [secret, setSecret] = useState('')
  useEffect(() => setUrl(baseUrl), [baseUrl])
  useEffect(() => setSecret(token ?? ''), [token])
  const invalid = url.trim() !== '' && !normalizeBaseUrl(url)

  const saveUrl = () => {
    if (!url.trim()) return setBaseUrl('')
    const next = normalizeBaseUrl(url)
    if (!next || next === baseUrl) return
    setBaseUrl(next)
    // `*.youtrack.cloud` is in the manifest; a self-hosted instance needs the user's yes.
    void net.requestHost(next, 'Your YouTrack server')
  }
  const saveToken = () => {
    const next = secret.trim() || null
    if (next !== token) void setToken(next)
  }

  return (
    <List.Section title="Connection">
      <List.Row label="Instance" description="Your YouTrack's address, such as team.youtrack.cloud.">
        <Input
          aria-label="Instance URL"
          value={url}
          invalid={invalid}
          placeholder="team.youtrack.cloud"
          className="w-56"
          onValueChange={setUrl}
          onBlur={saveUrl}
          onKeyDown={(event) => event.key === 'Enter' && saveUrl()}
        />
      </List.Row>
      <List.Row label="Token" description="A permanent token from your YouTrack profile › Account Security.">
        <Input
          aria-label="Permanent token"
          type="password"
          value={secret}
          placeholder="perm:…"
          className="w-56"
          onValueChange={setSecret}
          onBlur={saveToken}
          onKeyDown={(event) => event.key === 'Enter' && saveToken()}
        />
      </List.Row>
    </List.Section>
  )
}

function SearchSettings() {
  const [searches, setSearches] = useStorage<SavedSearch[]>(SEARCHES, DEFAULT_SEARCHES)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const add = () => {
    if (!name.trim() || !query.trim()) return
    setSearches([...searches, { name: name.trim(), query: query.trim() }])
    setName('')
    setQuery('')
  }

  return (
    <List.Section title="Saved searches">
      {searches.map((search, index) => (
        <List.Row key={index} label={search.name} description={search.query}>
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label={`Remove ${search.name}`}
            onClick={() => setSearches(searches.filter((_, i) => i !== index))}
          >
            <Trash2 />
          </Button>
        </List.Row>
      ))}
      <List.Row label="New tab" description="What the tab is called.">
        <Input aria-label="Tab name" value={name} placeholder="Updated today" className="w-56" onValueChange={setName} />
      </List.Row>
      <List.Row label="Query" description="YouTrack search syntax, as in its search bar.">
        <div className="flex items-center gap-2">
          <Input
            aria-label="Query"
            value={query}
            placeholder="updated: Today"
            className="w-48"
            onValueChange={setQuery}
            onKeyDown={(event) => event.key === 'Enter' && add()}
          />
          <Button variant="secondary" size="icon-compact" aria-label="Add search" disabled={!name.trim() || !query.trim()} onClick={add}>
            <Plus />
          </Button>
        </div>
      </List.Row>
    </List.Section>
  )
}

function Settings() {
  return (
    <List>
      <ConnectionSettings />
      <SearchSettings />
    </List>
  )
}

export default definePlugin({
  widget: { title: 'YouTrack', icon: ListChecks, view: Issues },
  settings: Settings,
})
