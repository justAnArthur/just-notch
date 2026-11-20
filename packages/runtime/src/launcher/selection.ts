/**
 * The selected row, by id: rows that arrive late (files, plugins) push it down the list without changing what ↩
 * runs. `undefined` until the user moves, when the first row is selected, whichever it is.
 */
export interface Selection {
  id: string
  /** Where it was, for when it disappears: the selection stays about there. */
  index: number
}

/** The index of the selected row in `rows`. */
export function selectedIndex(rows: readonly { id: string }[], selection: Selection | undefined): number {
  if (!selection || !rows.length) return 0
  const found = rows.findIndex((row) => row.id === selection.id)
  return found >= 0 ? found : Math.min(selection.index, rows.length - 1)
}

/** The row `step` away from the selected one, wrapping around the ends. */
export function moveSelection(rows: readonly { id: string }[], selection: Selection | undefined, step: number): Selection | undefined {
  if (!rows.length) return selection
  const index = (selectedIndex(rows, selection) + step + rows.length) % rows.length
  return { id: rows[index].id, index }
}

