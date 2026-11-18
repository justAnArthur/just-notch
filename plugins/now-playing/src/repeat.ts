import type { MediaRepeat } from '@just-notch/sdk'

/** The kit steps off → all → one; a mode the player lacks steps on to off. */
export function supportedRepeat(next: MediaRepeat, modes?: MediaRepeat[]): MediaRepeat {
  return !modes || modes.includes(next) ? next : 'off'
}
