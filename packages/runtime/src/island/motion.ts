import { spring } from '@justanarthur/modo-ui'
import type { IslandState } from '@just-notch/sdk'
import { type Transition, useReducedMotion, useReducedMotionConfig } from 'motion/react'

/** modo-ui's `useReduceMotion` (not in its public barrel): the OS setting, or a surrounding MotionConfig asking for it. */
export function useReduceMotion() {
  const os = useReducedMotion() ?? false
  const config = useReducedMotionConfig() ?? false
  return os || config
}

type Tier = (typeof spring)[keyof typeof spring]

const enter = ({ exit: _exit, ...transition }: Tier): Transition => transition

const SIZE: Record<IslandState, number> = { idle: 0, compact: 1, split: 1, flash: 2, expanded: 3 }
const TIER: Record<IslandState, Tier> = {
  idle: spring.moderate,
  compact: spring.moderate,
  split: spring.moderate,
  flash: spring.slow,
  expanded: spring.goo,
}

/** The bigger the move, the slower the tier: grow on the target's spring, shrink on the source's exit tween. */
export function shapeTransition(from: IslandState, to: IslandState): Transition {
  if (SIZE[to] >= SIZE[from]) return enter(TIER[to])
  return from === 'expanded' ? spring.slow.exit : TIER[from].exit
}

export const bubbleTransition = (detaching: boolean): Transition => (detaching ? enter(spring.goo) : spring.goo.exit)

/*
 * Apple's island content swap: arriving content sharpens and grows into place,
 * leaving content blurs out. Blur is a filter string a spring can't drive, so
 * these are tweens on a tier's duration, as modo-ui's icon swaps.
 */
// At rest the filter is dropped (`none`, not `blur(0px)`): any filter keeps an offscreen buffer alive.
export const contentShown = { opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }
export const contentHidden = { opacity: 0, scale: 0.94, filter: 'blur(6px)' }
export const contentEnter: Transition = { type: 'tween', duration: spring.slow.duration, ease: 'easeOut', delay: spring.fast.duration }
export const contentLeave: Transition = { type: 'tween', ...spring.fast.exit, ease: 'easeIn' }
