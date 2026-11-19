import { formatNumber, parseNumber, plain } from './format'
import type { InlineAnswer } from './types'

type Token =
  | { t: 'num'; v: number; raw: string; base?: Base }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string; binary?: boolean }

type Base = 'hex' | 'bin' | 'oct' | 'dec'

/** A value plus whether it came from a postfix `%`, so `80 + 15%` can mean 80 × 1.15. */
interface Val {
  v: number
  pct: boolean
}

const OPS: Record<string, string> = {
  '+': '+', '-': '-', '−': '-', '–': '-', '*': '*', '×': '*', '·': '*', '/': '/', '÷': '/',
  '^': '^', '%': '%', '!': '!', '(': '(', ')': ')',
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: 2 * Math.PI }

/** sin(π) is 1.2e-16 in floats; snap that to 0. */
const trig = (f: (x: number) => number) => (x: number) => {
  const r = f(x)
  return Math.abs(r) < 1e-15 ? 0 : r
}

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, sin: trig(Math.sin), cos: trig(Math.cos), tan: trig(Math.tan),
  asin: Math.asin, acos: Math.acos, atan: Math.atan, log: Math.log10, lg: Math.log10, ln: Math.log,
  abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, exp: Math.exp,
}

const NUMBER = /0x[0-9a-f]+|0b[01]+|0o[0-7]+|(?:\d+(?:[.,]\d+)*|[.,]\d+)(?:e[+-]?\d+)?/iy
const IDENT = /[a-zπ]+/iy
const PREFIX_BASE: Record<string, Base> = { '0x': 'hex', '0b': 'bin', '0o': 'oct' }

function lex(input: string, locale?: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const c = input[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    NUMBER.lastIndex = i
    IDENT.lastIndex = i
    const num = NUMBER.exec(input)
    if (num) {
      const raw = num[0]
      const base = PREFIX_BASE[raw.slice(0, 2).toLowerCase()]
      const v = base ? Number(raw.toLowerCase()) : parseNumber(raw.replace(/e.*$/i, ''), locale) * 10 ** Number(raw.match(/e([+-]?\d+)$/i)?.[1] ?? 0)
      if (!Number.isFinite(v)) return null
      tokens.push({ t: 'num', v, raw, base })
      i += raw.length
      continue
    }
    const id = IDENT.exec(input)
    if (id) {
      tokens.push({ t: 'id', v: id[0].toLowerCase() })
      i += id[0].length
      continue
    }
    if (input.startsWith('**', i)) {
      tokens.push({ t: 'op', v: '^' })
      i += 2
      continue
    }
    if (c === '√') tokens.push({ t: 'id', v: 'sqrt' })
    else if (OPS[c]) tokens.push({ t: 'op', v: OPS[c] })
    else return null
    i++
  }
  classify(tokens)
  return tokens
}

const isKeyword = (t?: Token) => t?.t === 'id' && (t.v === 'of' || t.v === 'off')
const startsValue = (t?: Token) => !!t && (t.t === 'num' || (t.t === 'id' && !isKeyword(t)) || t.v === '(')
const endsValue = (t?: Token) =>
  !!t && (t.t === 'num' || (t.t === 'id' && t.v in CONSTANTS) || (t.t === 'op' && [')', '!', '%'].includes(t.v) && !t.binary))

/** Marks binary vs unary minus and modulo vs percent, and reads `3x4` as 3 × 4. */
function classify(tokens: Token[]) {
  tokens.forEach((tok, i) => {
    const prev = tokens[i - 1]
    const next = tokens[i + 1]
    if (tok.t === 'id' && tok.v === 'x' && endsValue(prev) && next?.t === 'num') tokens[i] = { t: 'op', v: '*', binary: true }
    else if (tok.t !== 'op') return
    else if (tok.v === '%') tok.binary = endsValue(prev) && startsValue(next)
    else if (tok.v === '-' || tok.v === '+') tok.binary = endsValue(prev)
    else tok.binary = ['*', '/', '^'].includes(tok.v)
  })
}

class Parser {
  pos = 0
  operated = false
  constructor(private tokens: Token[]) {}

  parse(): number {
    const { v } = this.expr(0)
    if (this.pos < this.tokens.length || !Number.isFinite(v)) throw new SyntaxError()
    return v
  }

  private peek = () => this.tokens[this.pos]

  private lbp(t: Token): number {
    if (t.t === 'num') return 0
    if (t.t === 'id') return 20 // `of`, `off`, or implicit multiplication (`2pi`)
    switch (t.v) {
      case '+':
      case '-':
        return 10
      case '*':
      case '/':
      case '(':
        return 20
      case '%':
        return t.binary ? 20 : 50
      case '^':
        return 40
      case '!':
        return 50
      default:
        return 0
    }
  }

  private expr(rbp: number): Val {
    let left = this.nud()
    while (this.pos < this.tokens.length && this.lbp(this.peek()) > rbp) left = this.led(left)
    return left
  }

  private nud(): Val {
    const t = this.tokens[this.pos++]
    if (!t) throw new SyntaxError()
    if (t.t === 'num') return { v: t.v, pct: false }
    if (t.t === 'id') {
      if (t.v in CONSTANTS) return { v: CONSTANTS[t.v], pct: false }
      const f = FUNCTIONS[t.v]
      if (!f || !this.peek()) throw new SyntaxError()
      this.operated = true
      // `sin(x)^2` squares the sine; `sqrt 16` takes a bare argument.
      const arg = this.peek().v === '(' ? this.nud() : this.expr(35)
      return { v: f(arg.v), pct: false }
    }
    if (t.v === '-' || t.v === '+') {
      const x = this.expr(30)
      return { v: t.v === '-' ? -x.v : x.v, pct: x.pct }
    }
    if (t.v === '(') {
      const x = this.expr(0)
      if (this.peek()?.v === ')') this.pos++
      else if (this.peek()) throw new SyntaxError() // a missing trailing `)` is fine
      return x
    }
    throw new SyntaxError()
  }

  private led(left: Val): Val {
    const t = this.peek()
    this.operated = true
    if (t.t === 'id' && isKeyword(t)) {
      this.pos++
      if (!left.pct) throw new SyntaxError()
      const right = this.expr(20).v
      return { v: t.v === 'of' ? left.v * right : right * (1 - left.v), pct: false }
    }
    if (t.t !== 'op' || t.v === '(') {
      const right = this.expr(20)
      return { v: left.v * right.v, pct: false }
    }
    this.pos++
    const l = left.v
    switch (t.v) {
      case '!':
        return { v: factorial(l), pct: false }
      case '%':
        if (!t.binary) return { v: l / 100, pct: true }
        return { v: nonZero(this.expr(20).v, (r) => l % r), pct: false }
      case '^':
        return { v: l ** this.expr(39).v, pct: false }
    }
    const right = this.expr(this.lbp(t))
    const r = right.v
    switch (t.v) {
      case '+':
        return { v: right.pct ? l * (1 + r) : l + r, pct: false }
      case '-':
        return { v: right.pct ? l * (1 - r) : l - r, pct: false }
      case '*':
        return { v: l * r, pct: false }
      default:
        return { v: nonZero(r, (d) => l / d), pct: false }
    }
  }
}

function nonZero(d: number, f: (d: number) => number): number {
  if (d === 0) throw new RangeError()
  return f(d)
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw new RangeError()
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}

const BINARY_TEXT: Record<string, string> = { '*': '×', '/': '÷', '%': 'mod' }

/** The tokens re-joined with even spacing: "2*3+1" → "2 × 3 + 1". */
function tidy(tokens: Token[]): string {
  let out = ''
  let open = 0
  tokens.forEach((tok, i) => {
    const prev = tokens[i - 1]
    const text = tok.t === 'num' ? tok.raw : tok.t === 'op' && tok.binary ? (BINARY_TEXT[tok.v] ?? tok.v) : tok.v
    const spaced = (tok.t === 'op' && tok.binary) || isKeyword(tok) || (prev?.t === 'op' && prev.binary) || isKeyword(prev)
    const words = prev?.t === 'id' && (tok.t === 'id' || tok.t === 'num')
    if (prev && (spaced || words)) out += ' '
    out += text
    if (tok.v === '(') open++
    if (tok.v === ')') open--
  })
  return out + ')'.repeat(Math.max(0, open))
}

function evaluate(input: string, locale?: string): { value: number; operated: boolean; tokens: Token[] } | null {
  const tokens = lex(input, locale)
  if (!tokens?.length) return null
  try {
    const parser = new Parser(tokens)
    const value = parser.parse()
    return { value, operated: parser.operated, tokens }
  } catch {
    return null
  }
}

const BASE_NAMES: Record<string, Base> = {
  hex: 'hex', hexadecimal: 'hex', bin: 'bin', binary: 'bin', oct: 'oct', octal: 'oct', dec: 'dec', decimal: 'dec',
}
const BASE_RE = /^(.+?)(?:\s+(?:in|to|as|into)\s+|\s*(?:->|→|=)\s*)(hex|hexadecimal|bin|binary|oct|octal|dec|decimal)$/i

function inBase(n: number, base: Base): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (base === 'hex') return `${sign}0x${abs.toString(16).toUpperCase()}`
  if (base === 'bin') return `${sign}0b${abs.toString(2)}`
  if (base === 'oct') return `${sign}0o${abs.toString(8)}`
  return String(n)
}

/** "255 in hex", "0b1010 to decimal", or a bare literal like "0xff". */
function baseAnswer(input: string, locale?: string): InlineAnswer | null {
  const m = input.match(BASE_RE)
  if (!m) return null
  const source = evaluate(m[1], locale)
  const base = BASE_NAMES[m[2].toLowerCase()]
  if (!source || !Number.isSafeInteger(source.value)) return null
  const out = inBase(source.value, base)
  const display = base === 'dec' ? formatNumber(source.value, locale) : out
  return { kind: 'base', expression: `${tidy(source.tokens)} → ${m[2].toLowerCase()}`, result: display, copy: out }
}

export function mathAnswer(input: string, locale?: string): InlineAnswer | null {
  const text = input.replace(/^=\s*|\s*=$/g, '')
  const base = baseAnswer(text, locale)
  if (base) return base

  const found = evaluate(text, locale)
  if (!found) return null
  const { value, operated, tokens } = found
  const [first] = tokens
  if (tokens.length === 1 && first.t === 'num' && first.base) {
    return { kind: 'base', expression: first.raw, result: formatNumber(value, locale), copy: plain(value) }
  }
  // A lone number, constant or negation is not a sum to answer.
  if (!operated) return null
  return { kind: 'math', expression: tidy(tokens), result: formatNumber(value, locale), copy: plain(value) }
}
