import { describe, expect, test } from 'bun:test'
import { alerts, type Inbox, type InboxResponse, type PullRequest, shortRepo, toInbox } from '../src/github'

const rawPr = (over: Record<string, unknown> = {}) => ({
  url: 'https://github.com/acme/app/pull/12',
  number: 12,
  title: 'Faster builds',
  isDraft: false,
  updatedAt: '2026-11-18T10:00:00Z',
  reviewDecision: null,
  repository: { nameWithOwner: 'acme/app' },
  author: { login: 'octo' },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...over,
})

const response = (over: Partial<InboxResponse> = {}): InboxResponse => ({
  viewer: { login: 'me' },
  reviews: { nodes: [] },
  mine: { nodes: [] },
  issues: { nodes: [] },
  ...over,
})

describe('toInbox', () => {
  test('maps a pull request', () => {
    const inbox = toInbox(response({ reviews: { nodes: [rawPr() as never] } }))
    expect(inbox.login).toBe('me')
    expect(inbox.reviews).toEqual([
      {
        url: 'https://github.com/acme/app/pull/12',
        repo: 'acme/app',
        number: 12,
        title: 'Faster builds',
        author: 'octo',
        draft: false,
        updatedAt: Date.parse('2026-11-18T10:00:00Z'),
        checks: 'success',
        review: 'none',
      },
    ])
  })

  test.each([
    ['SUCCESS', 'success'],
    ['FAILURE', 'failure'],
    ['ERROR', 'failure'],
    ['PENDING', 'pending'],
    ['EXPECTED', 'pending'],
  ])('check rollup %s is %s', (state, checks) => {
    const raw = rawPr({ commits: { nodes: [{ commit: { statusCheckRollup: { state } } }] } })
    expect(toInbox(response({ mine: { nodes: [raw as never] } })).mine[0].checks).toBe(checks as PullRequest['checks'])
  })

  test('no checks: no rollup or no commits', () => {
    const noRollup = rawPr({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })
    const noCommits = rawPr({ commits: { nodes: [] } })
    expect(toInbox(response({ mine: { nodes: [noRollup, noCommits] as never } })).mine.map((pr) => pr.checks)).toEqual(['none', 'none'])
  })

  test.each([
    ['APPROVED', 'approved'],
    ['CHANGES_REQUESTED', 'changes'],
    ['REVIEW_REQUIRED', 'required'],
    [null, 'none'],
  ])('review decision %s is %s', (reviewDecision, review) => {
    expect(toInbox(response({ mine: { nodes: [rawPr({ reviewDecision }) as never] } })).mine[0].review).toBe(review as PullRequest['review'])
  })

  test('a deleted author is ghost', () => {
    expect(toInbox(response({ reviews: { nodes: [rawPr({ author: null }) as never] } })).reviews[0].author).toBe('ghost')
  })

  test('drops search nodes of another type', () => {
    expect(toInbox(response({ reviews: { nodes: [{}, rawPr() as never] } })).reviews).toHaveLength(1)
  })

  test('maps an issue with its labels', () => {
    const issue = {
      url: 'https://github.com/acme/app/issues/7',
      number: 7,
      title: 'Crash on start',
      updatedAt: '2026-11-17T08:00:00Z',
      repository: { nameWithOwner: 'acme/app' },
      labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
    }
    expect(toInbox(response({ issues: { nodes: [issue, { ...issue, labels: null }] } })).issues).toEqual([
      {
        url: issue.url,
        repo: 'acme/app',
        number: 7,
        title: 'Crash on start',
        updatedAt: Date.parse(issue.updatedAt),
        labels: [{ name: 'bug', color: '#d73a4a' }],
      },
      { url: issue.url, repo: 'acme/app', number: 7, title: 'Crash on start', updatedAt: Date.parse(issue.updatedAt), labels: [] },
    ])
  })
})

const pr = (n: number, over: Partial<PullRequest> = {}): PullRequest => ({
  url: `https://github.com/acme/app/pull/${n}`,
  repo: 'acme/app',
  number: n,
  title: `PR ${n}`,
  author: 'octo',
  draft: false,
  updatedAt: 0,
  checks: 'pending',
  review: 'required',
  ...over,
})

const inbox = (over: Partial<Inbox> = {}): Inbox => ({ login: 'me', reviews: [], mine: [], issues: [], ...over })

describe('alerts', () => {
  test('nothing on the first poll', () => {
    expect(alerts(undefined, inbox({ reviews: [pr(1)], mine: [pr(2, { checks: 'failure' })] }))).toEqual([])
  })

  test('a new review request', () => {
    const result = alerts(inbox({ reviews: [pr(1)] }), inbox({ reviews: [pr(1), pr(2)] }))
    expect(result.map((a) => [a.kind, a.pr.number])).toEqual([['review', 2]])
  })

  test('checks turning red on my PR, once', () => {
    const red = inbox({ mine: [pr(3, { checks: 'failure' })] })
    expect(alerts(inbox({ mine: [pr(3)] }), red).map((a) => a.kind)).toEqual(['failed'])
    expect(alerts(red, red)).toEqual([])
  })

  test('approval of my PR, once', () => {
    const approved = inbox({ mine: [pr(4, { review: 'approved' })] })
    expect(alerts(inbox({ mine: [pr(4, { review: 'changes' })] }), approved).map((a) => a.kind)).toEqual(['approved'])
    expect(alerts(approved, approved)).toEqual([])
  })

  test('a PR that just appeared is not news about its checks', () => {
    expect(alerts(inbox(), inbox({ mine: [pr(5, { checks: 'failure', review: 'approved' })] }))).toEqual([])
  })
})

test('shortRepo', () => {
  expect(shortRepo('acme/app')).toBe('app')
})
