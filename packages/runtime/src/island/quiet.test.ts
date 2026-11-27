import type { ScreenGeometry } from '@just-notch/bridge-schema'
import { describe, expect, it } from 'vitest'
import { presentedState, retracted, shapeFor } from './geometry'

const g: ScreenGeometry = {
  panel: { w: 800, h: 600 },
  notch: { x: 325, y: 0, w: 150, h: 32 },
  hasNotch: true,
  scale: 2,
  screenId: 's',
  mode: 'full',
}

describe('quiet (a full-screen app)', () => {
  const quiet = { ...g, quiet: true }

  it('drops ongoing activities but keeps flashes and the open island', () => {
    expect(presentedState('compact', quiet)).toBe('idle')
    expect(presentedState('split', quiet)).toBe('idle')
    expect(presentedState('flash', quiet)).toBe('flash')
    expect(presentedState('expanded', quiet)).toBe('expanded')
    expect(presentedState('compact', g)).toBe('compact')
  })

  it('draws nothing at idle, even on a full display', () => {
    expect(shapeFor('idle', quiet)).toEqual(retracted(quiet))
    expect(shapeFor('idle', g)).not.toEqual(retracted(g))
    expect(shapeFor('flash', quiet).h).toBeGreaterThan(g.notch.h)
  })
})
