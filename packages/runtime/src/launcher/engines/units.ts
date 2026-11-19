import { formatNumber, parseNumber, plain } from './format'
import type { InlineAnswer } from './types'

type Category = 'length' | 'mass' | 'volume' | 'temperature' | 'area' | 'speed' | 'data' | 'time'

interface Unit {
  symbol: string
  category: Category
  /** base = (value + offset) × factor; only temperatures have an offset. */
  factor: number
  offset: number
}

// [category, symbol, factor to the category's base unit, other names separated by |]
const TABLE: [Category, string, number, string][] = [
  ['length', 'mm', 0.001, 'millimeter|millimetre'],
  ['length', 'cm', 0.01, 'centimeter|centimetre'],
  ['length', 'dm', 0.1, 'decimeter|decimetre'],
  ['length', 'm', 1, 'meter|metre'],
  ['length', 'km', 1000, 'kilometer|kilometre'],
  ['length', 'µm', 1e-6, 'um|micrometer|micrometre|micron'],
  ['length', 'nm', 1e-9, 'nanometer|nanometre'],
  ['length', 'in', 0.0254, `inch|"|″|''`],
  ['length', 'ft', 0.3048, `foot|feet|'|′`],
  ['length', 'yd', 0.9144, 'yard'],
  ['length', 'mi', 1609.344, 'mile'],
  ['length', 'nmi', 1852, 'nautical mile'],
  ['mass', 'mg', 1e-6, 'milligram|milligramme'],
  ['mass', 'g', 0.001, 'gram|gramme|gr'],
  ['mass', 'kg', 1, 'kilogram|kilogramme|kilo'],
  ['mass', 't', 1000, 'tonne|metric ton'],
  ['mass', 'oz', 0.028349523125, 'ounce'],
  ['mass', 'lb', 0.45359237, 'pound'],
  ['mass', 'st', 6.35029318, 'stone'],
  ['mass', 'ton', 907.18474, 'short ton|us ton'],
  ['volume', 'ml', 0.001, 'milliliter|millilitre'],
  ['volume', 'cl', 0.01, 'centiliter|centilitre'],
  ['volume', 'dl', 0.1, 'deciliter|decilitre'],
  ['volume', 'l', 1, 'liter|litre|ltr'],
  ['volume', 'm³', 1000, 'm3|cubic meter|cubic metre'],
  ['volume', 'cm³', 0.001, 'cm3|cc|cubic centimeter|cubic centimetre'],
  ['volume', 'tsp', 0.00492892159375, 'teaspoon'],
  ['volume', 'tbsp', 0.01478676478125, 'tablespoon'],
  ['volume', 'fl oz', 0.0295735295625, 'floz|fluid ounce'],
  ['volume', 'cups', 0.2365882365, 'cup'],
  ['volume', 'pt', 0.473176473, 'pint'],
  ['volume', 'qt', 0.946352946, 'quart'],
  ['volume', 'gal', 3.785411784, 'gallon|us gallon'],
  ['volume', 'imp gal', 4.54609, 'imperial gallon|uk gallon'],
  ['area', 'mm²', 1e-6, 'mm2|sq mm|square millimeter|square millimetre'],
  ['area', 'cm²', 1e-4, 'cm2|sq cm|square centimeter|square centimetre'],
  ['area', 'm²', 1, 'm2|sq m|sqm|square meter|square metre'],
  ['area', 'km²', 1e6, 'km2|sq km|square kilometer|square kilometre'],
  ['area', 'ha', 1e4, 'hectare'],
  ['area', 'ac', 4046.8564224, 'acre'],
  ['area', 'ft²', 0.09290304, 'ft2|sq ft|sqft|square foot|square feet'],
  ['area', 'in²', 0.00064516, 'in2|sq in|square inch'],
  ['area', 'yd²', 0.83612736, 'yd2|sq yd|square yard'],
  ['area', 'mi²', 2589988.110336, 'mi2|sq mi|square mile'],
  ['speed', 'm/s', 1, 'mps|meter per second|meters per second|metre per second|metres per second'],
  ['speed', 'km/h', 1 / 3.6, 'kmh|kph|kmph|km/hr|kilometer per hour|kilometers per hour|kilometre per hour|kilometres per hour'],
  ['speed', 'mph', 0.44704, 'mi/h|mile per hour|miles per hour'],
  ['speed', 'kn', 1852 / 3600, 'knot|kt'],
  ['speed', 'ft/s', 0.3048, 'fps|foot per second|feet per second'],
  ['data', 'bit', 1 / 8, ''],
  ['data', 'B', 1, 'byte'],
  ['data', 'kB', 1e3, 'kilobyte'],
  ['data', 'MB', 1e6, 'megabyte'],
  ['data', 'GB', 1e9, 'gigabyte'],
  ['data', 'TB', 1e12, 'terabyte'],
  ['data', 'PB', 1e15, 'petabyte'],
  ['data', 'KiB', 1024, 'kibibyte'],
  ['data', 'MiB', 1024 ** 2, 'mebibyte'],
  ['data', 'GiB', 1024 ** 3, 'gibibyte'],
  ['data', 'TiB', 1024 ** 4, 'tebibyte'],
  ['data', 'kbit', 1e3 / 8, 'kilobit'],
  ['data', 'Mbit', 1e6 / 8, 'megabit'],
  ['data', 'Gbit', 1e9 / 8, 'gigabit'],
  ['time', 'ms', 0.001, 'millisecond|msec'],
  ['time', 's', 1, 'sec|second'],
  ['time', 'min', 60, 'minute'],
  ['time', 'h', 3600, 'hr|hour'],
  ['time', 'd', 86400, 'day'],
  ['time', 'wk', 604800, 'week'],
  ['time', 'mo', 2629746, 'month'],
  ['time', 'yr', 31556952, 'year'],
]

const TEMPERATURES: [string, number, number, string][] = [
  ['°C', 1, 273.15, 'c|celsius|centigrade'],
  ['°F', 5 / 9, 459.67, 'f|fahrenheit'],
  ['K', 1, 0, 'kelvin'],
]

const UNITS = new Map<string, Unit>()
const add = (unit: Unit, names: string) => {
  for (const name of [unit.symbol, ...names.split('|')].filter(Boolean)) UNITS.set(normalize(name), unit)
}
for (const [category, symbol, factor, names] of TABLE) add({ symbol, category, factor, offset: 0 }, names)
for (const [symbol, factor, offset, names] of TEMPERATURES) add({ symbol, category: 'temperature', factor, offset }, names)

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/°/g, '')
    .replace(/^deg(ree)?s? /, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function lookup(phrase: string): Unit | undefined {
  const key = normalize(phrase)
  if (!key) return undefined
  return UNITS.get(key) ?? (key.endsWith('es') ? UNITS.get(key.slice(0, -2)) : undefined) ?? (key.endsWith('s') ? UNITS.get(key.slice(0, -1)) : undefined)
}

/** A bare quantity ("5 km") converts to its usual counterpart. */
const DEFAULT_TARGET: Record<string, string> = {
  km: 'mi', mi: 'km', m: 'ft', ft: 'cm', in: 'cm', cm: 'in', kg: 'lb', lb: 'kg',
  '°C': '°F', '°F': '°C', l: 'gal', gal: 'l', 'km/h': 'mph', mph: 'km/h',
}

type Token = { num: number } | { word: string }
const TOKEN = /\s*(?:(\d+(?:[.,]\d+)*|[.,]\d+)|(->|→|=)|('{1,2}|"|′|″)|([a-zµ°][a-zµ°²³/]*(?:[23](?![\d.,]))?))\s*/iy
const SEPARATORS = new Set(['in', 'to', 'into', 'as', '->', '→', '='])

function lex(input: string, locale?: string): Token[] | null {
  const negative = /^[-−]/.test(input)
  const text = negative ? input.slice(1) : input
  const tokens: Token[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < text.length) {
    const m = TOKEN.exec(text)
    if (!m) return null
    if (m[1]) tokens.push({ num: parseNumber(m[1], locale) })
    else tokens.push({ word: (m[2] ?? m[3] ?? m[4]).toLowerCase() })
  }
  if (negative && 'num' in (tokens[0] ?? {})) (tokens[0] as { num: number }).num *= -1
  return tokens
}

interface Quantity {
  base: number
  unit: Unit
  display: string
}

/** "5 km", "6 ft 2 in", "5'11" (feet then inches), all of one category. */
function quantity(tokens: Token[], locale?: string): Quantity | null {
  const parts: { value: number; unit: Unit }[] = []
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i++]
    if (!('num' in tok) || !Number.isFinite(tok.num)) return null
    const words: string[] = []
    while (i < tokens.length && 'word' in tokens[i]) words.push((tokens[i++] as { word: string }).word)
    const prev = parts[parts.length - 1]?.unit
    const unit = words.length ? lookup(words.join(' ')) : prev?.symbol === 'ft' ? lookup('in') : undefined
    if (!unit || (prev && prev.category !== unit.category)) return null
    parts.push({ value: tok.num, unit })
  }
  if (!parts.length || (parts.length > 1 && parts[0].unit.category === 'temperature')) return null
  return {
    base: parts.reduce((sum, { value, unit }) => sum + (value + unit.offset) * unit.factor, 0),
    unit: parts[0].unit,
    display: parts.map(({ value, unit }) => `${formatNumber(value, locale)} ${unit.symbol}`).join(' '),
  }
}

function answer(from: Quantity, to: Unit, locale?: string): InlineAnswer {
  const value = from.base / to.factor - to.offset
  return {
    kind: 'unit',
    expression: `${from.display} → ${to.symbol}`,
    result: `${formatNumber(value, locale, 6)} ${to.symbol}`,
    copy: plain(value, 6),
  }
}

export function unitAnswer(input: string, locale?: string): InlineAnswer | null {
  const tokens = lex(input, locale)
  if (!tokens?.length) return null
  // Try the last separator first: in "1 in in cm" the first "in" is the unit.
  for (let i = tokens.length - 2; i > 0; i--) {
    const sep = tokens[i]
    if (!('word' in sep) || !SEPARATORS.has(sep.word)) continue
    const target = tokens.slice(i + 1)
    if (!target.every((t) => 'word' in t)) continue
    const from = quantity(tokens.slice(0, i), locale)
    const to = lookup(target.map((t) => (t as { word: string }).word).join(' '))
    if (from && to && from.unit.category === to.category) return answer(from, to, locale)
  }
  const bare = quantity(tokens, locale)
  const target = bare && DEFAULT_TARGET[bare.unit.symbol]
  return bare && target ? answer(bare, lookup(target) as Unit, locale) : null
}
