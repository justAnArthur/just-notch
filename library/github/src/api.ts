import type { PluginContext } from '@just-notch/sdk'
import { INBOX_QUERY, type Inbox, type InboxResponse, SEARCHES, toInbox } from './github'

const ENDPOINT = 'https://api.github.com/graphql'

export class GitHubError extends Error {
  constructor(
    message: string,
    /** The token is missing, wrong or expired: ask for a new one rather than retrying. */
    readonly auth = false,
  ) {
    super(message)
  }
}

/** The plugin's one network call, through the host (`net`, `api.github.com`). */
export async function fetchInbox(fetch: PluginContext['fetch'], token: string): Promise<Inbox> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    json: { query: INBOX_QUERY, variables: SEARCHES },
  }).catch(() => {
    throw new GitHubError("Can't reach GitHub")
  })
  if (response.status === 401) throw new GitHubError('GitHub rejected the token', true)
  if (!response.ok) throw new GitHubError(`GitHub answered ${response.status}`)
  const body = (await response.json()) as { data?: InboxResponse; errors?: { message: string }[] }
  if (!body.data) throw new GitHubError(body.errors?.[0]?.message ?? 'GitHub sent no data')
  return toInbox(body.data)
}
