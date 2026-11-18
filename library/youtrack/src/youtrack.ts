/** YouTrack REST: the URLs this plugin asks for and the issues it reads back. Pure, so it's tested without a host. */

export interface SavedSearch {
  name: string
  query: string
}

export const DEFAULT_SEARCHES: SavedSearch[] = [{ name: 'Assigned to me', query: 'for: me #Unresolved' }]

export interface Issue {
  id: string
  summary: string
  url: string
  state?: string
  /** The state's color in YouTrack, as `#rrggbb`. */
  stateColor?: string
  priority?: string
  assignee?: string
  resolved: boolean
  updated?: number
}

export const ISSUE_FIELDS =
  'idReadable,summary,resolved,updated,customFields(name,value(name,login,fullName,isResolved,color(background)))'

/** `team.youtrack.cloud`, `https://team.youtrack.cloud/`, `…/api` → `https://team.youtrack.cloud`. Keeps a path such as `/youtrack`. */
export function normalizeBaseUrl(input: string): string | undefined {
  const raw = input.trim()
  if (!raw) return undefined
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '')
    return `${url.origin}${path}`
  } catch {
    return undefined
  }
}

export function issuesUrl(baseUrl: string, query: string, top: number): string {
  const params = new URLSearchParams({ query: query.trim(), fields: ISSUE_FIELDS, $top: String(top) })
  return `${baseUrl}/api/issues?${params}`
}

export const issueUrl = (baseUrl: string, id: string) => `${baseUrl}/issue/${encodeURIComponent(id)}`

/** The query YouTrack's web UI runs for the same search. */
export const searchUrl = (baseUrl: string, query: string) => `${baseUrl}/issues?${new URLSearchParams({ q: query.trim() })}`

interface RawValue {
  name?: string
  login?: string
  fullName?: string
  isResolved?: boolean
  color?: { background?: string } | null
}

interface RawField {
  name?: string
  value?: RawValue | RawValue[] | null
}

export interface RawIssue {
  idReadable: string
  summary?: string | null
  resolved?: number | null
  updated?: number | null
  customFields?: RawField[]
}

const first = (value: RawField['value']) => (Array.isArray(value) ? value[0] : value ?? undefined)
const label = (value: RawValue | undefined) => value?.fullName || value?.name || value?.login

/** YouTrack's default custom fields, matched by name: projects that rename them show fewer columns, not wrong ones. */
export function mapIssue(raw: RawIssue, baseUrl: string): Issue {
  const field = (name: string) => first(raw.customFields?.find((f) => f.name?.toLowerCase() === name)?.value)
  const state = field('state')
  return {
    id: raw.idReadable,
    summary: raw.summary ?? '',
    url: issueUrl(baseUrl, raw.idReadable),
    state: state?.name,
    stateColor: state?.color?.background ?? undefined,
    priority: field('priority')?.name,
    assignee: label(field('assignee')),
    resolved: raw.resolved != null || state?.isResolved === true,
    updated: raw.updated ?? undefined,
  }
}

export type YouTrackError = 'unauthorized' | 'forbidden' | 'not-found' | 'bad-query' | 'server' | 'network'

export function errorFor(status: number): YouTrackError {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 400) return 'bad-query'
  return 'server'
}

export const ERROR_TEXT: Record<YouTrackError, { title: string; description: string }> = {
  unauthorized: { title: 'YouTrack turned the token down', description: 'Make a new permanent token and paste it in Settings.' },
  forbidden: { title: 'The token can’t read issues', description: 'Give the token the YouTrack scope.' },
  'not-found': { title: 'No YouTrack at that address', description: 'Check the instance URL in Settings.' },
  'bad-query': { title: 'YouTrack can’t read that query', description: 'Try it in YouTrack’s search, then paste it here.' },
  server: { title: 'YouTrack had a problem', description: 'Try again in a moment.' },
  network: { title: 'Can’t reach YouTrack', description: 'Check the instance URL and your connection, or allow Just Notch to reach it.' },
}
