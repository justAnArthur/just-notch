import { expect, test } from 'bun:test'
import { shortOutput } from '../src/output'

test('drops the owner and the kind', () => {
  expect(shortOutput("Arthur's AirPods Pro")).toBe('AirPods Pro')
  expect(shortOutput('Arthur’s Beats Studio')).toBe('Beats Studio')
  expect(shortOutput('MacBook Pro Speakers')).toBe('MacBook Pro')
  expect(shortOutput("Living Room's HomePod Output")).toBe('HomePod')
})

test('leaves a name with nothing to shorten', () => {
  expect(shortOutput('HomePod')).toBeUndefined()
  expect(shortOutput('Speakers')).toBeUndefined()
})
