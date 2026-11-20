import { describe, expect, it } from 'vitest'
import { type Knowledge, learn, queryBoost, record } from './frecency'
import { matchScore } from './match'
import { type Group, rankRoot } from './rank'
import type { Row } from './rows'
import { viewOf } from './sources'

const row = (id: string, title = id): Row => ({ id, title, actions: [] })
const scored = (query: string, ...titles: string[]) => titles.map((t) => ({ row: row(t), match: matchScore(query, t) }))
const titles = (sections: { title: string; rows: Row[] }[]) => sections.map((s) => `${s.title}: ${s.rows.map((r) => r.title).join(', ')}`)
const now = Date.UTC(2026, 10, 20)

describe('root ranking', () => {
  it('makes the best row from any provider the Top Hit, and orders sections by their best row', () => {
    const groups: Group[] = [
      { title: 'Applications', rows: scored('rea', 'Reality Composer') },
      { title: 'Actions', rows: [] },
      { title: 'Files', rows: scored('rea', 'README.md', 'Already read.txt') },
    ]
    expect(titles(rankRoot({ query: 'rea', groups, frecency: {}, knowledge: {}, web: [row('web', 'Search Google')], now }))).toEqual([
      'Top Hit: README.md',
      'Applications: Reality Composer',
      'Files: Already read.txt',
      'Web: Search Google',
    ])
  })

  it('makes a window layout the Top Hit when it is the best match', () => {
    const groups: Group[] = [
      { title: 'Applications', rows: scored('righ', 'Brightness Sync') },
      { title: 'Window Management', rows: scored('righ', 'Right Half', 'Top Right') },
    ]
    expect(titles(rankRoot({ query: 'righ', groups, frecency: {}, knowledge: {}, now }))[0]).toBe('Top Hit: Right Half')
  })

  it('puts the answer first, failed providers after the results and the web last', () => {
    const groups: Group[] = [
      { title: 'GitHub', failed: true, rows: [{ row: row('error:github', "Couldn't reach GitHub"), match: 0 }] },
      { title: 'Applications', rows: scored('cal', 'Calculator') },
    ]
    const answer = { title: 'Calculator', rows: [row('answer:math', '4')] }
    expect(titles(rankRoot({ query: 'cal', groups, frecency: {}, knowledge: {}, answer, web: [row('web')], now }))).toEqual([
      'Calculator: 4',
      'Top Hit: Calculator',
      "GitHub: Couldn't reach GitHub",
      'Web: web',
    ])
  })

  it('drops rows that do not match', () => {
    expect(rankRoot({ query: 'x', groups: [{ title: 'Files', rows: [{ row: row('a'), match: 0 }] }], frecency: {}, knowledge: {}, now })).toEqual([])
  })
})

describe('what was picked for what was typed', () => {
  const homeControl = Object.fromEntries([['HomeControl', Array.from({ length: 10 }, () => now)]])

  it('lets one pick of Home for "home" beat a habitual HomeControl', () => {
    const groups = (): Group[] => [{ title: 'Applications', rows: scored('home', 'Home', 'HomeControl').map((s) => ({ ...s, row: row(s.row.title) })) }]
    const before = rankRoot({ query: 'home', groups: groups(), frecency: homeControl, knowledge: {}, now })
    expect(before[0].rows[0].id).toBe('HomeControl')
    const frecency = record(homeControl, 'Home', now)
    const knowledge = learn({}, 'home', 'Home', now)
    expect(rankRoot({ query: 'home', groups: groups(), frecency, knowledge, now })[0].rows[0].id).toBe('Home')
  })

  it('counts the same query in full, a start of it by how much is typed, and a longer query by half', () => {
    const k = learn({}, 'home', 'Home', now)
    expect(queryBoost(k, 'home', 'Home', now)).toBe(200)
    expect(queryBoost(k, 'ho', 'Home', now)).toBe(100)
    expect(queryBoost(k, 'homes', 'Home', now)).toBe(100)
    expect(queryBoost(k, 'safari', 'Home', now)).toBe(0)
    expect(queryBoost(k, 'home', 'Other', now)).toBe(0)
  })

  it('keeps the most recently used queries', () => {
    let k: Knowledge = {}
    for (let i = 0; i < 305; i++) k = learn(k, `q${i}`, 'x', now + i)
    expect(Object.keys(k)).toHaveLength(300)
    expect(k.q0).toBeUndefined()
    expect(k.q304).toBeDefined()
  })
})

describe('sources', () => {
  it('shows the last answer while the fresh one loads, and says it is loading', () => {
    expect(viewOf({ key: 're', value: [1] }, 'rea')).toEqual({ value: [1], error: undefined, pending: true })
    expect(viewOf({ key: 'rea', value: [2] }, 'rea')).toEqual({ value: [2], error: undefined, pending: false })
    expect(viewOf({ key: 'rea', error: 'timeout' }, 'rea').error).toBe('timeout')
    expect(viewOf(undefined, 'rea').pending).toBe(true)
  })
})
