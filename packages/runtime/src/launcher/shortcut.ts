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
