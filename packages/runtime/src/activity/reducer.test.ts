import type { ActivitySpec, FlashSpec } from '@just-notch/sdk'
import { describe, expect, test } from 'vitest'
import { type ActivityAction, initialState, present, reduce } from './reducer'

const View = () => null
const activity = (priority: ActivitySpec['priority'], minimal = false): ActivitySpec => ({
  priority,
  compact: { leading: View },
  ...(minimal ? { minimal: View } : {}),
})
const flashSpec = (priority: FlashSpec['priority'], key?: string): FlashSpec => ({ priority, view: View, key })
const run = (...actions: ActivityAction[]) => actions.reduce(reduce, initialState)

describe('activities', () => {
  test('idle when nothing is active', () => {
    expect(present(initialState).island).toBe('idle')
  })

  test('the highest priority is primary', () => {
    const state = run(
      { type: 'show', plugin: 'cal', spec: activity('calendar') },
      { type: 'show', plugin: 'music', spec: activity('media') },
    )
    const p = present(state)
    expect(p.island).toBe('compact')
    expect(p.primary?.plugin).toBe('music')
  })

  test('a tie goes to the most recent', () => {
    const state = run(
      { type: 'show', plugin: 'a', spec: activity('timer') },
      { type: 'show', plugin: 'b', spec: activity('timer') },
    )
    expect(present(state).primary?.plugin).toBe('b')
    expect(present(reduce(state, { type: 'show', plugin: 'a', spec: activity('timer') })).primary?.plugin).toBe('a')
  })

  test('a secondary with a minimal view splits', () => {
    const state = run(
      { type: 'show', plugin: 'music', spec: activity('media') },
      { type: 'show', plugin: 'timer', spec: activity('timer', true) },
    )
    const p = present(state)
    expect(p.island).toBe('split')
    expect(p.secondary?.plugin).toBe('timer')
  })

  test('a secondary without a minimal view stays compact', () => {
    const state = run(
      { type: 'show', plugin: 'music', spec: activity('media') },
      { type: 'show', plugin: 'timer', spec: activity('timer') },
    )
    expect(present(state).island).toBe('compact')
  })

  test('swap trades the primary and the bubble until the activities change', () => {
    const split = run(
      { type: 'show', plugin: 'music', spec: activity('media', true) },
      { type: 'show', plugin: 'timer', spec: activity('timer', true) },
    )
    let state = reduce(split, { type: 'swap' })
    expect(present(state)).toMatchObject({ island: 'split', primary: { plugin: 'timer' }, secondary: { plugin: 'music' } })
    state = reduce(state, { type: 'show', plugin: 'music', spec: activity('media', true) })
    expect(present(state).primary?.plugin).toBe('timer')
    expect(present(reduce(state, { type: 'swap' })).primary?.plugin).toBe('music')
    state = reduce(state, { type: 'show', plugin: 'cal', spec: activity('calendar', true) })
    expect(present(state).primary?.plugin).toBe('music')
  })

  test('swap needs a minimal view on the primary', () => {
    const state = run(
      { type: 'show', plugin: 'music', spec: activity('media') },
      { type: 'show', plugin: 'timer', spec: activity('timer', true) },
    )
    expect(reduce(state, { type: 'swap' })).toBe(state)
  })

  test('show replaces the plugin activity, hide removes it', () => {
    let state = run({ type: 'show', plugin: 'music', spec: activity('media') }, { type: 'show', plugin: 'music', spec: activity('ambient') })
    expect(state.activities).toHaveLength(1)
    expect(state.activities[0].spec.priority).toBe('ambient')
    state = reduce(state, { type: 'hide', plugin: 'music' })
    expect(present(state).island).toBe('idle')
  })

  test('remove drops activities and flashes of a disabled plugin', () => {
    const state = run(
      { type: 'show', plugin: 'music', spec: activity('media') },
      { type: 'flash', plugin: 'music', spec: flashSpec('hud') },
      { type: 'flash', plugin: 'other', spec: flashSpec('hud') },
      { type: 'remove', plugin: 'music' },
    )
    expect(state.activities).toHaveLength(0)
    expect(state.flash?.plugin).toBe('other')
    expect(state.queue).toHaveLength(0)
  })
})

describe('flashes', () => {
  test('a flash wins over activities and ends back to them', () => {
    let state = run({ type: 'show', plugin: 'music', spec: activity('media') }, { type: 'flash', plugin: 'power', spec: flashSpec('alert') })
    expect(present(state).island).toBe('flash')
    state = reduce(state, { type: 'flashEnd', id: state.flash!.id })
    expect(present(state).island).toBe('compact')
  })

  test('flashes queue by priority', () => {
    let state = run(
      { type: 'flash', plugin: 'a', spec: flashSpec('hud') },
      { type: 'flash', plugin: 'b', spec: flashSpec('hud') },
      { type: 'flash', plugin: 'c', spec: flashSpec('alert') },
    )
    expect(state.flash?.plugin).toBe('a')
    expect(state.queue.map((f) => f.plugin)).toEqual(['c', 'b'])
    state = reduce(state, { type: 'flashEnd', id: state.flash!.id })
    expect(state.flash?.plugin).toBe('c')
  })

  test('the same key replaces the running flash in place and restarts it', () => {
    const first = run({ type: 'flash', plugin: 'audio', spec: flashSpec('hud', 'volume') })
    const second = reduce(first, { type: 'flash', plugin: 'audio', spec: flashSpec('hud', 'volume') })
    expect(second.queue).toHaveLength(0)
    expect(second.flash?.id).not.toBe(first.flash?.id)
    expect(reduce(second, { type: 'flashEnd', id: first.flash!.id })).toBe(second)
  })

  test('the same key replaces a queued flash', () => {
    const state = run(
      { type: 'flash', plugin: 'power', spec: flashSpec('alert') },
      { type: 'flash', plugin: 'audio', spec: flashSpec('hud', 'volume') },
      { type: 'flash', plugin: 'audio', spec: flashSpec('hud', 'volume') },
    )
    expect(state.queue).toHaveLength(1)
  })

  test('a key only matches within its plugin', () => {
    const state = run({ type: 'flash', plugin: 'a', spec: flashSpec('hud', 'k') }, { type: 'flash', plugin: 'b', spec: flashSpec('hud', 'k') })
    expect(state.queue).toHaveLength(1)
  })
})

describe('dismiss', () => {
  test('ends the running flash with the key and advances the queue', () => {
    const state = run(
      { type: 'flash', plugin: 'shelf', spec: flashSpec('alert', 'drop') },
      { type: 'flash', plugin: 'power', spec: flashSpec('alert') },
      { type: 'dismiss', plugin: 'shelf', key: 'drop' },
    )
    expect(state.flash?.plugin).toBe('power')
    expect(state.queue).toHaveLength(0)
  })

  test('without a key, drops every flash of the plugin, running and queued', () => {
    const state = run(
      { type: 'flash', plugin: 'a', spec: flashSpec('hud', 'x') },
      { type: 'flash', plugin: 'b', spec: flashSpec('hud') },
      { type: 'flash', plugin: 'a', spec: flashSpec('hud', 'y') },
      { type: 'dismiss', plugin: 'a' },
    )
    expect(state.flash?.plugin).toBe('b')
    expect(state.queue).toHaveLength(0)
  })

  test('another key or plugin is untouched', () => {
    const state = run({ type: 'flash', plugin: 'a', spec: flashSpec('hud', 'x') })
    expect(reduce(state, { type: 'dismiss', plugin: 'a', key: 'y' })).toBe(state)
    expect(reduce(state, { type: 'dismiss', plugin: 'b' })).toBe(state)
  })
})

describe('expansion', () => {
  test('expanded wins over everything, collapse returns', () => {
    let state = run({ type: 'flash', plugin: 'a', spec: flashSpec('alert') }, { type: 'expand' })
    expect(present(state).island).toBe('expanded')
    state = reduce(state, { type: 'collapse' })
    expect(present(state).island).toBe('flash')
  })

  test('no-op actions keep the state identity', () => {
    expect(reduce(initialState, { type: 'collapse' })).toBe(initialState)
    expect(reduce(initialState, { type: 'hide', plugin: 'x' })).toBe(initialState)
    expect(reduce(initialState, { type: 'flashEnd', id: 7 })).toBe(initialState)
  })
})
