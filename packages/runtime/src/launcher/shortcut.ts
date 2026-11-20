/** Electron accelerators (`Alt+Space`) ⇄ keys pressed and the symbols macOS shows (`⌥Space`). */

const MODIFIERS: [name: string, symbol: string, held: (e: KeyEventLike) => boolean][] = [
  ['Control', '⌃', (e) => e.ctrlKey],
  ['Alt', '⌥', (e) => e.altKey],
  ['Shift', '⇧', (e) => e.shiftKey],
  ['Command', '⌘', (e) => e.metaKey],
]

const ALIASES: Record<string, string> = {
  cmd: 'Command',
  command: 'Command',
  commandorcontrol: 'Command',
  cmdorctrl: 'Command',
  super: 'Command',
  meta: 'Command',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
}

const KEY_SYMBOLS: Record<string, string> = {
  Space: 'Space',
  Enter: '↩',
  Return: '↩',
  Tab: '⇥',
  Escape: '⎋',
  Backspace: '⌫',
  Delete: '⌦',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
}

export interface KeyEventLike {
  code: string
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** The host's key names for `KeyboardEvent.code`s (layout-independent, as Carbon's key codes are). */
function keyName(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|20)$/.test(code)) return code
  const named: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Backquote: '`',
  }
  return named[code]
}

/**
 * The accelerator a key press makes, or undefined while it isn't one yet (only modifiers held) or can't be
 * (no modifier: a global shortcut must have one, unless it's a function key).
 */
export function acceleratorOf(event: KeyEventLike): string | undefined {
  const key = keyName(event.code)
  if (!key) return undefined
  const modifiers = MODIFIERS.filter(([, , held]) => held(event)).map(([name]) => name)
  if (!modifiers.length && !/^F\d+$/.test(key)) return undefined
  return [...modifiers, key].join('+')
}

/** `Alt+Space` → `⌥Space`, in macOS's modifier order (⌃⌥⇧⌘). */
export function formatAccelerator(accelerator: string): string {
  const parts = accelerator.split('+').map((p) => p.trim())
  const key = parts.pop() ?? ''
  const held = new Set(parts.map((p) => ALIASES[p.toLowerCase()] ?? p))
  const symbols = MODIFIERS.filter(([name]) => held.has(name)).map(([, symbol]) => symbol)
  return symbols.join('') + (KEY_SYMBOLS[key] ?? key.toUpperCase())
}

/** Key names an accelerator may spell differently from `acceleratorOf`'s. */
const KEY_ALIASES: Record<string, string> = { period: '.', comma: ',', slash: '/', return: 'Enter', esc: 'Escape', del: 'Delete' }

/** `cmd+backspace` → `Command+Backspace`: modifiers by their names in macOS's order, the key as `acceleratorOf` names it. */
export function normalizeAccelerator(accelerator: string): string {
  const parts = accelerator.split('+').map((p) => p.trim())
  const key = parts.pop() ?? ''
  const held = new Set(parts.map((p) => ALIASES[p.toLowerCase()] ?? p))
  const modifiers = MODIFIERS.filter(([name]) => held.has(name)).map(([name]) => name)
  const named = KEY_ALIASES[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1))
  return [...modifiers, named].join('+')
}

/** The launcher's own keys, which a result's action can't take: ⌘K (actions), ⌘Y (preview), ⌘1–⌘9 (scopes). */
const RESERVED = /^Command\+[KY1-9]$/

/** Which of a result's actions this key press runs by its `shortcut`, or -1. */
export function actionForKey(actions: readonly { shortcut?: string }[], event: KeyEventLike): number {
  const pressed = acceleratorOf(event)
  if (!pressed || RESERVED.test(pressed)) return -1
  return actions.findIndex((a) => a.shortcut !== undefined && !RESERVED.test(normalizeAccelerator(a.shortcut)) && normalizeAccelerator(a.shortcut) === pressed)
}

/** ⌘1–⌘9 as a result's place (0–8), for a scope whose provider takes number keys; undefined for any other key. */
export function numberKey(event: KeyEventLike): number | undefined {
  const pressed = acceleratorOf(event)
  const match = pressed && /^Command\+([1-9])$/.exec(pressed)
  return match ? Number(match[1]) - 1 : undefined
}
