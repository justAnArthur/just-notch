import { describe, expect, test } from 'bun:test'
import { errorFor, ISSUE_FIELDS, issuesUrl, mapIssue, normalizeBaseUrl, type RawIssue, searchUrl } from '../src/youtrack'

const BASE = 'https://team.youtrack.cloud'

describe('normalizeBaseUrl', () => {
  test('adds https and drops trailing slashes and /api', () => {
    expect(normalizeBaseUrl('team.youtrack.cloud')).toBe(BASE)
    expect(normalizeBaseUrl(' https://team.youtrack.cloud/ ')).toBe(BASE)
    expect(normalizeBaseUrl('https://team.youtrack.cloud/api/')).toBe(BASE)
  })

  test('keeps a path prefix', () => {
    expect(normalizeBaseUrl('https://team.myjetbrains.com/youtrack/')).toBe('https://team.myjetbrains.com/youtrack')
  })

  test('rejects empty and non-http input', () => {
    expect(normalizeBaseUrl('  ')).toBeUndefined()
    expect(normalizeBaseUrl('ftp://team.youtrack.cloud')).toBeUndefined()
    expect(normalizeBaseUrl('http://')).toBeUndefined()
  })
})

describe('urls', () => {
  test('issuesUrl encodes the query, fields and limit', () => {
    const url = new URL(issuesUrl(BASE, ' for: me #Unresolved ', 50))
    expect(url.origin + url.pathname).toBe(`${BASE}/api/issues`)
    expect(url.searchParams.get('query')).toBe('for: me #Unresolved')
    expect(url.searchParams.get('fields')).toBe(ISSUE_FIELDS)
    expect(url.searchParams.get('$top')).toBe('50')
  })

  test('searchUrl opens the same query in the web UI', () => {
    expect(new URL(searchUrl(BASE, 'updated: Today')).searchParams.get('q')).toBe('updated: Today')
  })
})

describe('mapIssue', () => {
  const raw: RawIssue = {
    idReadable: 'APP-42',
    summary: 'Crash on launch',
    resolved: null,
    updated: 1_700_000_000_000,
    customFields: [
      { name: 'Priority', value: { name: 'Critical' } },
      { name: 'State', value: { name: 'In Progress', isResolved: false, color: { background: '#ff0000' } } },
      { name: 'Assignee', value: { name: 'jdoe', login: 'jdoe', fullName: 'Jane Doe' } },
    ],
  }

  test('reads the default fields', () => {
    expect(mapIssue(raw, BASE)).toEqual({
      id: 'APP-42',
      summary: 'Crash on launch',
      url: `${BASE}/issue/APP-42`,
      state: 'In Progress',
      stateColor: '#ff0000',
      priority: 'Critical',
      assignee: 'Jane Doe',
      resolved: false,
      updated: 1_700_000_000_000,
    })
  })

  test('takes the first of a multi-value field and falls back to login', () => {
    const issue = mapIssue({ idReadable: 'APP-1', customFields: [{ name: 'assignee', value: [{ login: 'bob' }, { login: 'amy' }] }] }, BASE)
    expect(issue.assignee).toBe('bob')
  })

  test('missing fields stay undefined', () => {
    const issue = mapIssue({ idReadable: 'APP-2', summary: null, customFields: [{ name: 'Assignee', value: null }] }, BASE)
    expect(issue).toMatchObject({ summary: '', state: undefined, priority: undefined, assignee: undefined, resolved: false })
  })

  test('resolved from the timestamp or a resolved state', () => {
    expect(mapIssue({ idReadable: 'A-1', resolved: 1 }, BASE).resolved).toBe(true)
    expect(mapIssue({ idReadable: 'A-2', customFields: [{ name: 'State', value: { name: 'Done', isResolved: true } }] }, BASE).resolved).toBe(true)
  })
})

test('errorFor maps statuses', () => {
  expect([400, 401, 403, 404, 500].map(errorFor)).toEqual(['bad-query', 'unauthorized', 'forbidden', 'not-found', 'server'])
})

describe('missingSuggestions', () => {
  test('a removed default search is offered again', () => {
    const { missingSuggestions, DEFAULT_SEARCHES } = require('../src/youtrack') as typeof import('../src/youtrack')
    expect(missingSuggestions([]).map((s) => s.name)).toContain(DEFAULT_SEARCHES[0].name)
    expect(missingSuggestions(DEFAULT_SEARCHES).map((s) => s.name)).not.toContain(DEFAULT_SEARCHES[0].name)
  })

  test('matches on the query, ignoring case and spaces', () => {
    const { missingSuggestions } = require('../src/youtrack') as typeof import('../src/youtrack')
    const saved = [{ name: 'Mine', query: '  FOR: ME #Unresolved ' }]
    expect(missingSuggestions(saved).some((s) => s.query === 'for: me #Unresolved')).toBe(false)
  })
})
