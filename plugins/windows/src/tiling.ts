import type { TilingSettings } from '@just-notch/sdk'

/** Desktop & Dock, where macOS's tiling switches live. */
export const DESKTOP_SETTINGS = 'x-apple.systempreferences:com.apple.Desktop-Settings.extension'

/** Whether macOS snaps windows on its own as well: drag to an edge or the menu bar, or ⌥-drag. Margins alone don't. */
export const tilingOn = (t: TilingSettings) => t.edgeDrag || t.topEdgeDrag || t.optionDrag

export const TILING_TITLE = 'macOS tiles windows too'
/** Short enough for the notch. */
export const TILING_CAPTION = 'Turn it off in Desktop & Dock'
export const TILING_DETAIL = 'Dragging a window to an edge snaps it as well. Turn that off in Desktop & Dock if the two get in the way.'
