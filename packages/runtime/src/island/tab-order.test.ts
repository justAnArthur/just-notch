import type { ScreenGeometry } from '@just-notch/bridge-schema'
import type { ActivitySpec } from '@just-notch/sdk'
import { describe, expect, test } from 'vitest'
import type { ActivityEntry } from '../activity/reducer'
import type { LoadedPlugin } from '../plugins/loader'
import { EXPANDED, stripLayout } from './geometry'
import { openingTab, rememberEmpty, tabsOf } from './tab-order'

const View = () => null

const plugin = (id: string, widget = true) =>
  ({
    installed: { manifest: { id, name: id } },
    definition: widget ? { widget: { title: id, view: View } } : {},
  }) as unknown as LoadedPlugin

const activity = (plugin: string, seq = 1): ActivityEntry => ({
  plugin,
  seq,
  spec: { priority: 'media', compact: { leading: View, trailing: View }, expanded: View } as ActivitySpec,
})

const plugins = ['now-playing', 'calendar', 'weather', 'clipboard', 'recent-files'].map((id) => plugin(id))
const ids = (primary?: ActivityEntry) => tabsOf(primary, plugins).map((t) => t.id)

describe('tabsOf', () => {
  test('keeps the plugins’ order whatever the primary activity', () => {
    const order = ids()
    for (const [i, id] of ['calendar', 'now-playing', 'weather', 'recent-files', 'calendar', 'clipboard', 'now-playing', 'weather', 'calendar', 'recent-files'].entries())
      expect(ids(activity(id, i))).toEqual(order)
  })

  test('puts the built-ins in their own order, then the rest in the host’s', () => {
    const host = ['calendar', 'clipboard', 'github', 'now-playing', 'acme', 'recent-files', 'weather'].map((id) => plugin(id))
    expect(tabsOf(undefined, host).map((t) => t.plugin)).toEqual(['now-playing', 'calendar', 'weather', 'clipboard', 'recent-files', 'github', 'acme'])
  })

  test('shows the widget on its plugin’s tab, not the activity’s own view (one view per tab)', () => {
    const own = () => null
    const primary = { ...activity('calendar'), spec: { ...activity('calendar').spec, expanded: own } }
    expect(tabsOf(primary, plugins).find((t) => t.plugin === 'calendar')?.view).toBe(View)
  })

  test('a plugin without a widget gets a tab for its activity, in its place, only while it lasts', () => {
    const list = [plugin('a'), plugin('timer', false), plugin('b')]
    expect(tabsOf(undefined, list).map((t) => t.plugin)).toEqual(['a', 'b'])
    expect(tabsOf(activity('timer'), list).map((t) => t.id)).toEqual(['widget:a', 'activity:timer', 'widget:b'])
  })
})

describe('openingTab', () => {
  const tabs = tabsOf(undefined, plugins)

  test('opens on the primary activity’s tab', () => {
    expect(openingTab(tabs, 'widget:weather', activity('calendar'))).toBe('widget:calendar')
  })

  test('else on the last tab shown, while it has content', () => {
    expect(openingTab(tabs, 'widget:weather')).toBe('widget:weather')
    expect(openingTab(tabs, null)).toBe('widget:now-playing')
  })

  test('else on the first tab with content', () => {
    rememberEmpty('widget:now-playing', true)
    rememberEmpty('widget:weather', true)
    expect(openingTab(tabs, 'widget:weather')).toBe('widget:calendar')
    expect(openingTab(tabs, 'settings')).toBe('widget:calendar')
    rememberEmpty('widget:now-playing', false)
    expect(openingTab(tabs, 'widget:weather')).toBe('widget:now-playing')
    rememberEmpty('widget:weather', false)
  })
})

describe('stripLayout', () => {
  const g = { notch: { x: 0, y: 0, w: 200, h: 32 } } as ScreenGeometry

  test('up to six tabs all sit in the left wing', () => {
    for (const count of [1, 5, 6]) expect(stripLayout(count, EXPANDED.w, g)).toMatchObject({ before: count, overflow: false })
  })

  test('more than six flow on into the right wing', () => {
    const layout = stripLayout(8, EXPANDED.w, g)
    expect(layout.before).toBeLessThan(8)
    expect(layout.overflow).toBe(false)
  })
})
