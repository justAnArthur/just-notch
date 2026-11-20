import type { IconProps } from '@just-notch/sdk'
import type { ComponentType } from 'react'
import type { InlineAnswer } from './engines'

/** Something a row does: the first runs on ↩, the second on ⌘↩, the third on ⇧↩. */
export interface RowAction {
  title: string
  /** A glyph beside it in the ⌘K list. */
  icon?: ComponentType<IconProps>
  /** Asks for a second ↩ before it runs (Empty Trash), with this line in the row meanwhile. */
  confirm?: string
  run(): void | Promise<void>
  /** Runs it while its row is selected, in accelerator syntax (`Command+.`); shown in the ⌘K list. */
  shortcut?: string
  /** Runs with the launcher still open (Pin, Delete, Retry), then the providers are asked again. */
  stay?: boolean
}

/** What draws a row's icon: a file's or app's own icon (by path), an image, or a glyph. */
export type RowIcon = { path: string } | { src: string } | { glyph: ComponentType<IconProps> }

/** What the preview pane shows: a file's Quick Look thumbnail (by path) or an image, text, then label and value lines. */
export interface RowPreview {
  thumbnail?: string
  image?: string
  text?: string
  mono?: boolean
  details?: { label: string; value: string }[]
}

/** One result, from any provider. */
export interface Row {
  /** Stable across searches; frecency is kept by it. */
  id: string
  title: string
  subtitle?: string
  icon?: RowIcon
  /** Short text at the row's end while it isn't selected (a kind, a date). */
  accessory?: string
  actions: RowAction[]
  preview?: RowPreview
  /** The inline answer card (maths, conversions) instead of a plain row. */
  answer?: InlineAnswer
  /** The plugin that made it, which shows the failure if one of its actions throws. */
  plugin?: string
  /** A provider's error row ("Couldn't reach GitHub"): muted, with Retry. */
  failed?: boolean
}

export interface Section {
  title: string
  rows: Row[]
}
