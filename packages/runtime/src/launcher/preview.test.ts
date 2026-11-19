import { describe, expect, it } from 'vitest'
import { hasPreviews } from './preview'
import { formatBytes } from './providers'

describe('formatBytes', () => {
  it('uses decimal units, as Finder does', () => {
    expect(formatBytes(512)).toBe('512 bytes')
    expect(formatBytes(1_500)).toBe('1.5 KB')
    expect(formatBytes(2_400_000)).toBe('2.4 MB')
    expect(formatBytes(734_000_000)).toBe('734 MB')
    expect(formatBytes(3_200_000_000_000)).toBe('3.2 TB')
  })
})

describe('hasPreviews', () => {
  const row = (preview?: object) => ({ id: 'a', title: 'a', actions: [], preview })
  it('is true when any row has a preview', () => {
    expect(hasPreviews([row(), row({ text: 'x' })])).toBe(true)
    expect(hasPreviews([row(), row()])).toBe(false)
  })
})
