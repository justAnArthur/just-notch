import { expect, test } from 'vitest'
import { deepLinkTarget } from './deep-link'

test.each([
  ['justnotch://library', { page: 'library' }],
  ['justnotch://library/', { page: 'library' }],
  ['justnotch://library/github', { page: 'library', library: 'github' }],
  ['justnotch://library/my-plugin/', { page: 'library', library: 'my-plugin' }],
  ['justnotch://library/../etc', { page: 'library', library: 'etc' }],
  ['justnotch://library/Bad_Id', undefined],
  ['justnotch://library/a/b', undefined],
  ['justnotch://settings', { page: 'general' }],
  ['justnotch://settings/permissions', { page: 'permissions' }],
  ['justnotch://settings/about/', { page: 'about' }],
  ['justnotch://settings/plugin:github', undefined],
  ['justnotch://settings/nope', undefined],
  ['justnotch://other', undefined],
  ['https://library/github', undefined],
  ['not a url', undefined],
])('%s', (url, expected) => expect(deepLinkTarget(url)).toEqual(expected))
