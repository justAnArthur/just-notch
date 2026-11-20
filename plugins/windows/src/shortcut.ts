/** Accelerators (`Control+Alt+Left`) ⇄ key presses and the symbols macOS shows (`⌃⌥←`). */

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
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const NAMED: Record<string, string> = {
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

/** The host's key name for a `KeyboardEvent.code` (layout-independent, as Carbon's key codes are). */
function keyName(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|20)$/.test(code)) return code
  return NAMED[code]
}

/** The accelerator a key press makes; undefined while only modifiers are held, or with none (unless a function key). */
export function acceleratorOf(event: KeyEventLike): string | undefined {
  const key = keyName(event.code)
  if (!key) return undefined
  const modifiers = MODIFIERS.filter(([, , held]) => held(event)).map(([name]) => name)
  if (!modifiers.length && !/^F\d+$/.test(key)) return undefined
  return [...modifiers, key].join('+')
}

/** One spelling per shortcut (`ctrl+option+Left` → `Control+Alt+left`), so two bindings compare equal. */
export function normalize(accelerator: string): string {
  const parts = accelerator.split('+').map((p) => p.trim())
  const key = parts.pop() ?? ''
  const held = new Set(parts.map((p) => ALIASES[p.toLowerCase()] ?? p))
  return [...MODIFIERS.filter(([name]) => held.has(name)).map(([name]) => name), key.toLowerCase()].join('+')
}

/** `Control+Alt+Left` → `⌃⌥←`, in macOS's modifier order (⌃⌥⇧⌘). */
export function formatAccelerator(accelerator: string): string {
  const parts = accelerator.split('+').map((p) => p.trim())
  const key = parts.pop() ?? ''
  const held = new Set(parts.map((p) => ALIASES[p.toLowerCase()] ?? p))
  return MODIFIERS.filter(([name]) => held.has(name)).map(([, symbol]) => symbol).join('') + (KEY_SYMBOLS[key] ?? key.toUpperCase())
}

/** Shortcuts macOS or Just Notch itself take first, so one bound here would never arrive. */
const RESERVED: Record<string, string> = Object.fromEntries(
  Object.entries({
  'Control+Left': 'Mission Control (previous Space)',
  'Control+Right': 'Mission Control (next Space)',
  'Control+Up': 'Mission Control',
  'Control+Down': 'App Exposé',
  'Command+Space': 'Spotlight',
  'Command+Tab': 'the app switcher',
  'Control+Command+F': 'full screen',
  'Control+Command+Q': 'Lock Screen',
  'Shift+Command+3': 'screenshots',
  'Shift+Command+4': 'screenshots',
  'Shift+Command+5': 'screenshots',
  'Alt+Space': 'the Just Notch launcher',
  }).map(([accelerator, by]) => [normalize(accelerator), by]),
)

export function reservedBy(accelerator: string): string | undefined {
  return RESERVED[normalize(accelerator)]
}
