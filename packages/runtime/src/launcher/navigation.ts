import type { KeyEventLike } from './shortcut'
import { type Selection, selectedIndex } from './selection'

/** A move through the results: by rows, to an end, a section or a page. */
export type Move = { step: 1 | -1 } | { to: 'first' | 'last' } | { section: 1 | -1 } | { page: 1 | -1 }

/** Rows a page moves: about what the sheet shows. */
const PAGE = 8

/**
 * The move a key makes, or undefined: ↑↓ and Emacs's ⌃P ⌃N (and ⌃K ⌃J, as Raycast has them) by one row, ⌘↑ ⌘↓ by
 * section, Home and End to the ends, Page Up and Page Down by a page.
 */
export function moveOf(event: KeyEventLike & { key: string }): Move | undefined {
  const { key, metaKey: meta, ctrlKey: ctrl, altKey: alt, shiftKey: shift } = event
  if (alt || shift) return undefined
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (ctrl) return undefined
    const step = key === 'ArrowDown' ? 1 : -1
    return meta ? { section: step } : { step }
  }
  if (ctrl && !meta) {
    const letter = key.toLowerCase()
    if (letter === 'n' || letter === 'j') return { step: 1 }
    if (letter === 'p' || letter === 'k') return { step: -1 }
    return undefined
  }
  if (meta || ctrl) return undefined
  if (key === 'Home') return { to: 'first' }
  if (key === 'End') return { to: 'last' }
  if (key === 'PageDown') return { page: 1 }
  if (key === 'PageUp') return { page: -1 }
}

/** Where `move` takes the selection among `rows`, grouped in sections of `sizes` rows each. */
export function moveTo(rows: readonly { id: string }[], sizes: number[], selection: Selection | undefined, move: Move): Selection | undefined {
  if (!rows.length) return selection
  const at = selectedIndex(rows, selection)
  let next = at
  if ('step' in move) next = (at + move.step + rows.length) % rows.length
  else if ('to' in move) next = move.to === 'first' ? 0 : rows.length - 1
  else if ('page' in move) next = Math.min(rows.length - 1, Math.max(0, at + move.page * PAGE))
  else {
    // The starts of the sections: ⌘↓ goes to the next one's first row, ⌘↑ to this one's (or the previous one's).
    const starts = sizes.reduce<number[]>((acc, size, i) => [...acc, i ? acc[i - 1] + sizes[i - 1] : 0], []).filter((s) => s < rows.length)
    if (move.section === 1) next = starts.find((s) => s > at) ?? starts[0]
    else next = [...starts].reverse().find((s) => s < at) ?? starts[starts.length - 1]
  }
  return { id: rows[next].id, index: next }
}

/** ↑ in an empty field, before any move, steps back through what was typed before; ↓ steps forward again. */
export function recall(history: string[], at: number | undefined, step: 1 | -1): number | undefined {
  if (!history.length) return undefined
  if (at === undefined) return step === 1 ? 0 : undefined
  const next = at + step
  return next < 0 ? undefined : Math.min(next, history.length - 1)
}
