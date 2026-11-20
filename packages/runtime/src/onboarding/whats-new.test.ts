import { expect, test } from 'vitest'
import { parseReleaseNotes, releasePage } from './whats-new'

const body = `## Release Notes


### Changes

#### calendar
- **feat**: one mark per wing, minutes in the bubble

#### now-playing
- **feat**: short output names, 20 px artwork in the wing

#### services
- **feat**: animate window moves

#### windows
- **fix**: say macOS tiles windows too on the first hotkey, not at launch
- **feat**: ignore apps, macOS tiling notice, animate switch

#### Other Changes

`

test('areas a buyer reads, each with its history', () => {
  expect(parseReleaseNotes(body)).toEqual([
    {
      id: 'calendar',
      name: 'Calendar',
      changes: ['One mark per wing, minutes in the bubble'],
      history: 'https://github.com/justAnArthur/just-notch/commits/main/plugins/calendar',
    },
    {
      id: 'now-playing',
      name: 'Now Playing',
      changes: ['Short output names, 20 px artwork in the wing'],
      history: 'https://github.com/justAnArthur/just-notch/commits/main/plugins/now-playing',
    },
    {
      id: 'services',
      name: 'Under the hood',
      changes: ['Animate window moves'],
      history: 'https://github.com/justAnArthur/just-notch/commits/main/apps/macos/Packages/NotchServices',
    },
    {
      id: 'windows',
      name: 'Windows',
      changes: ['Fixed: say macOS tiles windows too on the first hotkey, not at launch', 'Ignore apps, macOS tiling notice, animate switch'],
      history: 'https://github.com/justAnArthur/just-notch/commits/main/plugins/windows',
    },
  ])
})

test('nothing to say is nothing', () => {
  expect(parseReleaseNotes('## Release Notes\n\n#### Other Changes\n')).toEqual([])
})

test('the release page escapes the tag', () => {
  expect(releasePage('1.9.0')).toBe('https://github.com/justAnArthur/just-notch/releases/tag/just-notch%401.9.0')
})
