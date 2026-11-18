import { describe, expect, test } from 'vitest'
import { COMMIT_PX, commit, type Gesture, isFresh, type Sample, swipeOf, track } from './gestures'

/** Feeds samples through the recognizer the way the hook does, collecting committed swipes. */
function run(samples: Sample[]) {
  let g: Gesture | undefined
  const swipes: string[] = []
  for (const s of samples) {
    g = track(isFresh(g, s) ? undefined : g, s)
    const swipe = swipeOf(g)
    if (swipe) {
      swipes.push(swipe)
      commit(g, s, swipe)
    }
  }
  return swipes
}

const stroke = (from: number, n: number, x: number, y: number, every = 16): Sample[] =>
  Array.from({ length: n }, (_, i) => ({ t: from + i * every, x, y }))

describe('swipes', () => {
  test('one swipe per gesture, its momentum included', () => {
    const momentum = Array.from({ length: 30 }, (_, i) => ({ t: 200 + i * 16, x: 0, y: 12 * 0.85 ** i }))
    expect(run([...stroke(0, 12, 0, 12), ...momentum])).toEqual(['down'])
  })

  test('the axis locks to the larger travel', () => {
    expect(run(stroke(0, 10, -10, 3))).toEqual(['left'])
    expect(run(stroke(0, 10, 2, -10))).toEqual(['up'])
  })

  test('a small nudge commits nothing', () => {
    expect(run(stroke(0, 3, 0, (COMMIT_PX - 5) / 3))).toEqual([])
  })

  test('a quiet gap starts a new gesture', () => {
    expect(run([...stroke(0, 8, 10, 0), ...stroke(600, 8, 10, 0)])).toEqual(['right', 'right'])
  })

  test('a fresh push after the momentum faded starts a new gesture without a gap', () => {
    const momentum = Array.from({ length: 12 }, (_, i) => ({ t: 128 + i * 16, x: -12 * 0.7 ** i, y: 0 }))
    expect(run([...stroke(0, 8, -12, 0), ...momentum, ...stroke(320, 8, -12, 0)])).toEqual(['left', 'left'])
  })

  test('fingers turning back within one gesture move one tab, not two', () => {
    const slowing = Array.from({ length: 6 }, (_, i) => ({ t: 128 + i * 16, x: -12 * 0.6 ** i, y: 0 }))
    expect(run([...stroke(0, 8, -12, 0), ...slowing, ...stroke(224, 10, 12, 0)])).toEqual(['left'])
  })
})

describe('swipes in the app (the host ends committed gestures)', () => {
  /**
   * Samples tagged `touch` follow the host's announcement of a new touch. A scroller under the pointer can
   * scroll until `scrollsUntil` (ms): a gesture that finds it scrolling belongs to it, as in the hook.
   */
  function runNative(samples: (Sample & { touch?: boolean })[], scrollsUntil = -1) {
    let g: Gesture | undefined
    let touches = 0
    const swipes: string[] = []
    for (const s of samples) {
      if (s.touch) touches++
      const fresh = isFresh(g, s, touches)
      g = track(fresh ? undefined : g, s)
      if (fresh) g.touch = touches
      if (g.owner === 'tracking' && g.axis && s.t < scrollsUntil) {
        g.owner = 'scroller'
        continue
      }
      const swipe = swipeOf(g)
      if (swipe) {
        swipes.push(swipe)
        commit(g, s, swipe, touches)
      }
    }
    return swipes
  }
  const touched = (samples: Sample[]) => samples.map((s, i) => (i === 0 ? { ...s, touch: true } : s))

  test('one swipe counts once, however its speed swings and however long its tail', () => {
    const uneven = [30, 8, 2, 25, 40, 5, 60, 3, 45].map((x, i) => ({ t: i * 40, x: -x, y: 0 }))
    expect(runNative(uneven)).toEqual(['left'])
  })

  test('a scroll that runs into the end of a list stays a scroll; only the next touch swipes', () => {
    // A flick up whose momentum swings (it fades, then bumps) long after the list hit its end at 150 ms.
    const flick = [...stroke(0, 6, 0, -14), ...[8, 3, 1, 20, 18, 15, 10, 6, 3, 1].map((y, i) => ({ t: 100 + i * 40, x: 0, y: -y }))]
    expect(runNative(flick, 150)).toEqual([])
    expect(runNative([...flick, ...touched(stroke(700, 6, 0, -12))], 150)).toEqual(['up'])
  })

  test('each new touch swipes again, fast and either way', () => {
    expect(runNative([...stroke(0, 6, 12, 0), ...touched(stroke(120, 6, 12, 0)), ...touched(stroke(240, 6, -12, 0))])).toEqual([
      'right',
      'right',
      'left',
    ])
  })
})
