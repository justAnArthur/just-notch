import { describe, expect, it } from 'vitest'
import { filterActions, launcherActions, panelHeight } from './actions'
import { withDefaults } from './prefs'

const action = (title: string) => ({ title, run: () => {} })
const actions = [action('Open'), action('Show in Finder'), action('Copy Path')]
const app = { id: 'app:com.apple.Safari', title: 'Safari', actions }

describe('filterActions', () => {
  it('lists every action in order when nothing is typed, the launcher’s last', () => {
    const own = launcherActions(app, withDefaults({}))
    expect(filterActions(actions, '  ', own).map((a) => a.command ?? a.index)).toEqual([0, 1, 2, 'alias', 'hotkey', 'favourite', 'reset'])
  })

  it('keeps matching actions with their place in the row', () => {
    const listed = filterActions(actions, 'copy')
    expect(listed.map((a) => [a.action.title, a.index])).toEqual([['Copy Path', 2]])
  })

  it('finds the launcher’s own actions too', () => {
    expect(filterActions(actions, 'fav', launcherActions(app, withDefaults({}))).map((a) => a.command)).toEqual(['favourite'])
  })

  it('lists nothing when no action matches', () => {
    expect(filterActions(actions, 'zzz')).toEqual([])
  })
})

describe('launcherActions', () => {
  it('names what is set already', () => {
    const prefs = withDefaults({ items: { [app.id]: { alias: 'sf', hotkey: 'Alt+Command+S' } }, favourites: [app.id] })
    expect(launcherActions(app, prefs).map((a) => a.title)).toEqual(['Edit Alias “sf”…', 'Change Hotkey ⌥⌘S…', 'Remove from Favourites', 'Reset Ranking'])
  })

  it('offers nothing for the web search, an answer or an error row', () => {
    expect(launcherActions({ id: 'fallback:google', title: 'Search', actions }, withDefaults({}))).toEqual([])
    expect(launcherActions({ id: 'error:files', title: 'Files took too long', actions, failed: true }, withDefaults({}))).toEqual([])
  })
})

describe('panelHeight', () => {
  it('keeps room for one line when nothing matches, and for the divider and the search line', () => {
    expect(panelHeight([])).toBe(panelHeight(filterActions([actions[0]], '')))
    const mixed = filterActions(actions, '', launcherActions(app, withDefaults({})))
    expect(panelHeight(mixed)).toBeGreaterThan(panelHeight(filterActions(actions, '')))
  })
})
