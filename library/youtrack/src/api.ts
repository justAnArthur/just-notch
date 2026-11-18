import type { PluginContext } from '@just-notch/sdk'
import { errorFor, type Issue, issuesUrl, mapIssue, type RawIssue, type YouTrackError } from './youtrack'

export interface Connection {
  baseUrl: string
  token: string
}

export type SearchResult = { issues: Issue[] } | { error: YouTrackError }

/** Through the host's `net.fetch`: no CORS, and it rejects for a host the user hasn't allowed. */
export async function searchIssues(fetch: PluginContext['fetch'], { baseUrl, token }: Connection, query: string, top: number): Promise<SearchResult> {
  let response: Response
  try {
    response = await fetch(issuesUrl(baseUrl, query, top), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
  } catch {
    return { error: 'network' }
  }
  if (!response.ok) return { error: errorFor(response.status) }
  const raw = (await response.json()) as RawIssue[]
  return { issues: raw.map((issue) => mapIssue(issue, baseUrl)) }
}
