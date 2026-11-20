/** The figure inside the split bubble's ring: whole minutes to go, rounded up, or `now` inside the last minute. */
export function ringFigure(msLeft: number): string {
  return msLeft >= 60_000 ? String(Math.ceil(msLeft / 60_000)) : 'now'
}
