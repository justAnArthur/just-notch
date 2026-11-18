/** GitHub's GraphQL answer mapped onto what the island shows, and the changes worth an alert. */

export type Checks = 'success' | 'failure' | 'pending' | 'none'
export type Review = 'approved' | 'changes' | 'required' | 'none'

export interface PullRequest {
  url: string
  repo: string
  number: number
  title: string
  author: string
  draft: boolean
  updatedAt: number
  checks: Checks
  review: Review
}

export interface Issue {
  url: string
  repo: string
  number: number
  title: string
  updatedAt: number
  labels: { name: string; color: string }[]
}

export interface Inbox {
  login: string
  /** Open PRs waiting for the viewer's review. */
  reviews: PullRequest[]
  /** The viewer's own open PRs. */
  mine: PullRequest[]
  /** Open issues assigned to the viewer. */
  issues: Issue[]
}

const LIMIT = 20

export const SEARCHES = {
  reviews: 'is:open is:pr review-requested:@me archived:false sort:updated-desc',
  mine: 'is:open is:pr author:@me archived:false sort:updated-desc',
  issues: 'is:open is:issue assignee:@me archived:false sort:updated-desc',
}

export const INBOX_QUERY = `
query Inbox($reviews: String!, $mine: String!, $issues: String!) {
  viewer { login }
  reviews: search(query: $reviews, type: ISSUE, first: ${LIMIT}) { nodes { ...Pr } }
  mine: search(query: $mine, type: ISSUE, first: ${LIMIT}) { nodes { ...Pr } }
  issues: search(query: $issues, type: ISSUE, first: ${LIMIT}) {
    nodes {
      ... on Issue {
        url number title updatedAt
        repository { nameWithOwner }
        labels(first: 3) { nodes { name color } }
      }
    }
  }
}
fragment Pr on PullRequest {
  url number title isDraft updatedAt reviewDecision
  repository { nameWithOwner }
  author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`

interface RawPr {
  url: string
  number: number
  title: string
  isDraft: boolean
  updatedAt: string
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  repository: { nameWithOwner: string }
  author: { login: string } | null
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
}

interface RawIssue {
  url: string
  number: number
  title: string
  updatedAt: string
  repository: { nameWithOwner: string }
  labels: { nodes: { name: string; color: string }[] } | null
}

export interface InboxResponse {
  viewer: { login: string }
  reviews: { nodes: (RawPr | Record<string, never>)[] }
  mine: { nodes: (RawPr | Record<string, never>)[] }
  issues: { nodes: (RawIssue | Record<string, never>)[] }
}

function checks(state: string | undefined): Checks {
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'none'
  }
}

const REVIEW: Record<NonNullable<RawPr['reviewDecision']>, Review> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  REVIEW_REQUIRED: 'required',
}

/** Search nodes of another type come back as `{}`. */
const present = <T extends { url: string }>(node: T | Record<string, never>): node is T => 'url' in node

export function toPullRequest(raw: RawPr): PullRequest {
  return {
    url: raw.url,
    repo: raw.repository.nameWithOwner,
    number: raw.number,
    title: raw.title,
    author: raw.author?.login ?? 'ghost',
    draft: raw.isDraft,
    updatedAt: Date.parse(raw.updatedAt),
    checks: checks(raw.commits.nodes[0]?.commit.statusCheckRollup?.state),
    review: raw.reviewDecision ? REVIEW[raw.reviewDecision] : 'none',
  }
}

export function toIssue(raw: RawIssue): Issue {
  return {
    url: raw.url,
    repo: raw.repository.nameWithOwner,
    number: raw.number,
    title: raw.title,
    updatedAt: Date.parse(raw.updatedAt),
    labels: (raw.labels?.nodes ?? []).map((l) => ({ name: l.name, color: `#${l.color}` })),
  }
}

export function toInbox(data: InboxResponse): Inbox {
  return {
    login: data.viewer.login,
    reviews: data.reviews.nodes.filter(present).map(toPullRequest),
    mine: data.mine.nodes.filter(present).map(toPullRequest),
    issues: data.issues.nodes.filter(present).map(toIssue),
  }
}

export type AlertKind = 'review' | 'failed' | 'approved'

export interface Alert {
  kind: AlertKind
  pr: PullRequest
}

/**
 * What changed between two polls that deserves a flash. Nothing on the first
 * poll: what was already there isn't news.
 */
export function alerts(before: Inbox | undefined, after: Inbox): Alert[] {
  if (!before) return []
  const was = new Map(before.mine.map((pr) => [pr.url, pr]))
  const asked = new Set(before.reviews.map((pr) => pr.url))
  return [
    ...after.reviews.filter((pr) => !asked.has(pr.url)).map((pr) => ({ kind: 'review' as const, pr })),
    ...after.mine
      .filter((pr) => pr.checks === 'failure' && was.has(pr.url) && was.get(pr.url)!.checks !== 'failure')
      .map((pr) => ({ kind: 'failed' as const, pr })),
    ...after.mine
      .filter((pr) => pr.review === 'approved' && was.has(pr.url) && was.get(pr.url)!.review !== 'approved')
      .map((pr) => ({ kind: 'approved' as const, pr })),
  ]
}

/** `owner/repo` → `repo`, for rows where space is short. */
export const shortRepo = (repo: string) => repo.slice(repo.indexOf('/') + 1)
