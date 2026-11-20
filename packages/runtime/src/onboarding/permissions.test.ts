import { expect, test } from 'vitest'
import { filesState } from '../settings/folder-access'
import { CARDS } from './permissions'

test('folder access, once asked, is allowed or off', () => {
  expect(filesState('granted')).toBe('allowed')
  expect(filesState('denied')).toBe('off')
})

test('the tour asks for each permission once, Accessibility after the ones that need no setup', () => {
  const ids = CARDS.map((card) => card.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids.indexOf('accessibility')).toBeGreaterThan(ids.indexOf('files'))
})
