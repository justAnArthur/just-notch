import { useReducedMotion, useReducedMotionConfig } from 'motion/react'

/** modo-ui's `useReduceMotion` (not in its public barrel): the OS setting, or a surrounding MotionConfig asking for it. */
export function useReduceMotion() {
  const os = useReducedMotion() ?? false
  const config = useReducedMotionConfig() ?? false
  return os || config
}

// The island moves on the kit's one motion scale; the runtime writes no tiers or durations of its own.
export {
  bubbleTransition,
  contentEnter,
  contentFade,
  contentGone,
  contentHidden,
  contentLeave,
  contentShown,
  hoverDelay,
  motionScale,
  shapeTransition,
} from '@justanarthur/modo-ui-notch/lib/motion'
