import { expect, test } from 'bun:test'
import { supportedRepeat } from '../src/repeat'

test('every mode when the player lists none', () => {
  expect(supportedRepeat('one')).toBe('one')
  expect(supportedRepeat('all', undefined)).toBe('all')
})

test('a missing mode steps on to off', () => {
  expect(supportedRepeat('all', ['off', 'all'])).toBe('all')
  expect(supportedRepeat('one', ['off', 'all'])).toBe('off')
})
