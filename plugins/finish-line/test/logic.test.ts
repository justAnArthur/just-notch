import { describe, expect, it } from 'bun:test'
import { apply, formatElapsed, parseTaskLink, shortElapsed, STALE_MS } from '../src/logic'

describe('task links', () => {
  it('reads start and end links', () => {
    expect(parseTaskLink('justnotch://task/start?id=1-2&title=npm%20install&app=com.apple.Terminal')).toEqual({
      kind: 'start',
      id: '1-2',
      title: 'npm install',
      app: 'com.apple.Terminal',
    })
    expect(parseTaskLink('justnotch://task/end?id=1-2&title=make&status=2&seconds=95')).toEqual({ kind: 'end', id: '1-2', title: 'make', app: undefined, status: 2, seconds: 95 })
  })

  it('rejects other links and bad ids, and tames titles and apps', () => {
    expect(parseTaskLink('justnotch://settings/general')).toBeNull()
    expect(parseTaskLink('justnotch://task/start?title=x')).toBeNull()
    expect(parseTaskLink('justnotch://task/start?id=../../x')).toBeNull()
    expect(parseTaskLink('justnotch://task/other?id=1')).toBeNull()
    expect(parseTaskLink('https://task/start?id=1')).toBeNull()
    expect(parseTaskLink(`justnotch://task/start?id=1&title=${'a'.repeat(300)}`)?.title.length).toBe(120)
    expect(parseTaskLink('justnotch://task/start?id=1&app=evil%20app')).toMatchObject({ app: undefined, title: 'Command' })
  })
})

describe('running tasks', () => {
  const start = parseTaskLink('justnotch://task/start?id=a&title=build')!
  const end = parseTaskLink('justnotch://task/end?id=a&title=build&status=0')!

  it('adds once and ends with how long it took', () => {
    let { tasks } = apply([], start, 1000)
    tasks = apply(tasks, start, 2000).tasks
    expect(tasks).toHaveLength(1)
    const done = apply(tasks, end, 61_000)
    expect(done.tasks).toEqual([])
    expect(done.seconds).toBe(60)
  })

  it('prefers the shell’s own duration and drops stale tasks', () => {
    expect(apply([], parseTaskLink('justnotch://task/end?id=b&seconds=12')!, 0).seconds).toBe(12)
    const { tasks } = apply([], start, 0)
    expect(apply(tasks, parseTaskLink('justnotch://task/start?id=c')!, STALE_MS + 1).tasks.map((t) => t.id)).toEqual(['c'])
  })
})

describe('durations', () => {
  it('reads well', () => {
    expect(formatElapsed(45)).toBe('45 s')
    expect(formatElapsed(133)).toBe('2 min 13 s')
    expect(formatElapsed(120)).toBe('2 min')
    expect(formatElapsed(3900)).toBe('1 h 5 min')
    expect(shortElapsed(45)).toBe('45s')
    expect(shortElapsed(130)).toBe('2m')
    expect(shortElapsed(7300)).toBe('2h')
  })
})
