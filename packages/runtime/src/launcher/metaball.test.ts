import { describe, expect, it } from 'vitest'
import { bridgePath } from './metaball'

describe('bridgePath', () => {
  const a = { x: 0, y: 0, r: 20 }

  it('joins circles that are close', () => {
    expect(bridgePath(a, { x: 0, y: 40, r: 12 })).toMatch(/^M.*C.*L.*C.*Z$/)
  })

  it('snaps once they are past reach, or when one sits inside the other', () => {
    expect(bridgePath(a, { x: 0, y: 20 + 12 + 12 * 2.5 + 1, r: 12 })).toBe('')
    expect(bridgePath(a, { x: 0, y: 2, r: 5 })).toBe('')
    expect(bridgePath(a, { x: 0, y: 30, r: 0 })).toBe('')
  })

  it('reaches less far with a smaller reach', () => {
    const b = { x: 0, y: 50, r: 12 }
    expect(bridgePath(a, b, 2.5)).not.toBe('')
    expect(bridgePath(a, b, 1)).toBe('')
  })
})
