import { expect, test } from 'bun:test'
import { ringFigure } from '../src/wings'

test('minutes to go, rounded up', () => {
  expect(ringFigure(8 * 60_000)).toBe('8')
  expect(ringFigure(7 * 60_000 + 1)).toBe('8')
  expect(ringFigure(60_000)).toBe('1')
})

test('now inside the last minute and after the start', () => {
  expect(ringFigure(59_000)).toBe('now')
  expect(ringFigure(-30_000)).toBe('now')
})
