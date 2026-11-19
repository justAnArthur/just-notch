import type { CurrencyRates } from '@just-notch/bridge-schema'
import { describe, expect, it } from 'vitest'
import { formatNumber, parseNumber } from './format'
import { type AnswerEnv, inlineAnswer } from './index'

const rates: CurrencyRates = { base: 'EUR', date: '2026-11-18', rates: { USD: 1.25, GBP: 0.85, JPY: 160, CZK: 25 } }
// Thursday 19 Nov 2026, 12:00 in London (GMT).
const env: AnswerEnv = { locale: 'en-GB', timeZone: 'Europe/London', now: new Date('2026-11-19T12:00:00Z'), rates }

const answer = (input: string, extra: AnswerEnv = {}) => inlineAnswer(input, { ...env, ...extra })
const copy = (input: string, extra?: AnswerEnv) => answer(input, extra)?.copy
const result = (input: string, extra?: AnswerEnv) => answer(input, extra)?.result

describe('not an answer', () => {
  it.each([
    '', ' ', 'safari', 'notes 2', 'iphone 15', '42', '2026', '-5', '(42)', '1,000,000', 'pi', 'e', 'sin', 'x',
    '1password', '7-zip', '4k', '3d', 'c++', '2 3', 'screen time', 'time', 'now', 'timer', '$5', '5 usd', '12 usd to',
    '3 min', 'in', 'to eur', 'time in atlantis', 'days until never', '1/0', '5 % 0', '(-1)!', '2.5!', 'sqrt(-1)',
    'log(0)', 'notes 2 to eur', '5 km in kg', '1 gb in mi', '100 xyz in usd', 'mail',
  ])('%j', (input) => {
    expect(answer(input)).toBeNull()
  })
})

describe('maths', () => {
  it.each([
    ['1+2', '3'],
    ['2 * 3 + 4', '10'],
    ['2 + 3 * 4', '14'],
    ['(2 + 3) * 4', '20'],
    ['(2 + 3 * 4', '14'],
    ['((1+2)*(3', '9'],
    ['10 / 4', '2.5'],
    ['10 ÷ 4', '2.5'],
    ['3 × 4', '12'],
    ['3x4', '12'],
    ['2^10', '1024'],
    ['2**3', '8'],
    ['2^3^2', '512'],
    ['-2^2', '-4'],
    ['2^-1', '0.5'],
    ['−3 + 1', '-2'],
    ['--3 + 1', '4'],
    ['0.1+0.2', '0.3'],
    ['1/3', '0.3333333333'],
    ['2pi', '6.283185307'],
    ['2π', '6.283185307'],
    ['3(4+1)', '15'],
    ['(1+1)(2+2)', '8'],
    ['5!', '120'],
    ['0!', '1'],
    ['3!+1', '7'],
    ['10 % 3', '1'],
    ['sqrt(16)', '4'],
    ['sqrt 16 + 9', '13'],
    ['√16', '4'],
    ['cbrt(27)', '3'],
    ['sin(0)', '0'],
    ['sin(pi)', '0'],
    ['cos(pi)', '-1'],
    ['tan(0)', '0'],
    ['sin(pi/2)^2', '1'],
    ['asin(1)*2', '3.141592654'],
    ['log(1000)', '3'],
    ['ln(e)', '1'],
    ['exp(0)+1', '2'],
    ['abs(-5)', '5'],
    ['round(2.5)', '3'],
    ['floor(2.7)', '2'],
    ['ceil(2.1)', '3'],
    ['e^1', '2.718281828'],
    ['1,000,000 / 4', '250000'],
    ['1,5 + 1', '2.5'],
    ['.5 + .25', '0.75'],
    ['2e3 + 1', '2001'],
    ['= 2 + 2', '4'],
    ['2 + 2 =', '4'],
  ])('%s → %s', (input, expected) => {
    expect(answer(input)?.kind).toBe('math')
    expect(copy(input)).toBe(expected)
  })

  it('percent phrases', () => {
    expect(copy('15% of 80')).toBe('12')
    expect(copy('80 + 15%')).toBe('92')
    expect(copy('80 - 15%')).toBe('68')
    expect(copy('20% off 50')).toBe('40')
    expect(copy('50 * 10%')).toBe('5')
    expect(copy('15%')).toBe('0.15')
    expect(answer('15% of 80')?.expression).toBe('15% of 80')
  })

  it('tidies the expression', () => {
    expect(answer('2*3+1')?.expression).toBe('2 × 3 + 1')
    expect(answer('10/-2')?.expression).toBe('10 ÷ -2')
    expect(answer('(1+2')?.expression).toBe('(1 + 2)')
    expect(answer('2pi')?.expression).toBe('2pi')
    expect(answer('sin 30')?.expression).toBe('sin 30')
  })

  it('formats for the locale and keeps big and small numbers readable', () => {
    expect(result('1000 * 1000')).toBe('1,000,000')
    expect(copy('1000 * 1000')).toBe('1000000')
    expect(result('1000 * 1000', { locale: 'de-DE' })).toBe('1.000.000')
    expect(result('1,5 * 2', { locale: 'de-DE' })).toBe('3')
    expect(result('1.000 * 2', { locale: 'de-DE' })).toBe('2.000')
    expect(result('1 / 4', { locale: 'de-DE' })).toBe('0,25')
    expect(result('10^20 * 1.5')).toBe('1.5 × 10²⁰')
    expect(result('1 / 10^9')).toBe('1 × 10⁻⁹')
    expect(result('20!')).toBe('2.432902008 × 10¹⁸')
  })
})

describe('number bases', () => {
  it('converts to and from hex, binary and octal', () => {
    expect(answer('255 in hex')).toEqual({ kind: 'base', expression: '255 → hex', result: '0xFF', copy: '0xFF' })
    expect(copy('10 to binary')).toBe('0b1010')
    expect(copy('8 as oct')).toBe('0o10')
    expect(copy('0xff in decimal')).toBe('255')
    expect(copy('(200 + 55) in hex')).toBe('0xFF')
    expect(answer('0xff')).toMatchObject({ kind: 'base', result: '255', copy: '255' })
    expect(copy('0b101')).toBe('5')
    expect(copy('0o17')).toBe('15')
    expect(answer('0xff + 1')).toMatchObject({ kind: 'math', copy: '256' })
    expect(answer('2.5 in hex')).toBeNull()
  })
})

describe('units', () => {
  it.each([
    ['5 km in mi', '3.10686', '3.10686 mi'],
    ['5km to miles', '3.10686', '3.10686 mi'],
    ['10 kg in lb', '22.0462', '22.0462 lb'],
    ['100f to c', '37.7778', '37.7778 °C'],
    ['-40 c to f', '-40', '-40 °F'],
    ['0 c in k', '273.15', '273.15 K'],
    ['100 degrees fahrenheit in celsius', '37.7778', '37.7778 °C'],
    ["5'11 in cm", '180.34', '180.34 cm'],
    ['5\'11" in cm', '180.34', '180.34 cm'],
    ['6 ft 2 in to cm', '187.96', '187.96 cm'],
    ['1 in in cm', '2.54', '2.54 cm'],
    ['12 inches to feet', '1', '1 ft'],
    ['1 gb in mb', '1000', '1,000 MB'],
    ['1 GiB in MiB', '1024', '1,024 MiB'],
    ['8 bits in bytes', '1', '1 B'],
    ['60 mph in km/h', '96.5606', '96.5606 km/h'],
    ['100 kph in mph', '62.1371', '62.1371 mph'],
    ['1 l in cups', '4.22675', '4.22675 cups'],
    ['1 gallon to liters', '3.78541', '3.78541 l'],
    ['1 acre in m2', '4046.86', '4,046.86 m²'],
    ['1 hectare in sq ft', '107639', '107,639 ft²'],
    ['90 min in h', '1.5', '1.5 h'],
    ['2 hours in minutes', '120', '120 min'],
    ['1,5 km in m', '1500', '1,500 m'],
    ['1 mile → km', '1.60934', '1.60934 km'],
    ['10 pounds in kg', '4.53592', '4.53592 kg'],
  ])('%s', (input, expectedCopy, expectedResult) => {
    expect(answer(input)?.kind).toBe('unit')
    expect(copy(input)).toBe(expectedCopy)
    expect(result(input)).toBe(expectedResult)
  })

  it('shows what it understood', () => {
    expect(answer("5'11 in cm")?.expression).toBe('5 ft 11 in → cm')
    expect(answer('5km to miles')?.expression).toBe('5 km → mi')
  })

  it('converts a bare quantity metric ↔ imperial', () => {
    expect(result('5 km')).toBe('3.10686 mi')
    expect(result('100 °F')).toBe('37.7778 °C')
    expect(result('20 c')).toBe('68 °F')
    expect(result('10 kg')).toBe('22.0462 lb')
    expect(result('2 l')).toBe('0.528344 gal')
    expect(result("5'11")).toBe('180.34 cm')
  })
})

describe('currency', () => {
  it.each([
    ['12 usd to eur', '9.60', '9.60 EUR', '12 USD → EUR'],
    ['12usd in eur', '9.60', '9.60 EUR', '12 USD → EUR'],
    ['€12 to $', '15.00', '15.00 USD', '12 EUR → USD'],
    ['100 czk in usd', '5.00', '5.00 USD', '100 CZK → USD'],
    ['100 kč in usd', '5.00', '5.00 USD', '100 CZK → USD'],
    ['£10 to ¥', '1882', '1,882 JPY', '10 GBP → JPY'],
    ['10 dollars in euros', '8.00', '8.00 EUR', '10 USD → EUR'],
    ['1,000 USD → GBP', '680.00', '680.00 GBP', '1,000 USD → GBP'],
  ])('%s', (input, expectedCopy, expectedResult, expression) => {
    expect(answer(input)).toEqual({
      kind: 'currency',
      expression,
      result: expectedResult,
      copy: expectedCopy,
      detail: 'ECB rates of 18 Nov 2026',
    })
  })

  it('needs rates and known currencies', () => {
    expect(answer('12 usd to eur', { rates: null })).toBeNull()
    expect(answer('12 usd to eur', { rates: undefined })).toBeNull()
    expect(answer('12 usd to xyz')).toBeNull()
    expect(answer('12 usd to eur', { rates: { ...rates, rates: {} } })).toBeNull()
  })
})

describe('time zones', () => {
  it('shows the time somewhere now', () => {
    expect(answer('time in tokyo')).toEqual({
      kind: 'time',
      expression: 'Time in Tokyo',
      result: '21:00 in Tokyo (Thu)',
      copy: '21:00',
      detail: 'Asia/Tokyo · UTC+9',
    })
    expect(copy('now in new york')).toBe('07:00')
    expect(copy('what time is it in sydney')).toBe('23:00')
    expect(copy('london time')).toBe('12:00')
    expect(answer('time in mumbai')?.detail).toBe('Asia/Kolkata · UTC+5:30')
    expect(result('time in nyc', { locale: 'en-US' })).toBe('7:00 AM in New York (Thu)')
  })

  it('converts a time between zones', () => {
    expect(answer('5pm london in tokyo')).toEqual({
      kind: 'time',
      expression: '17:00 London → Tokyo',
      result: '02:00 in Tokyo (Fri)',
      copy: '02:00',
      detail: 'Europe/London → Asia/Tokyo',
    })
    expect(copy('17:00 cet to pst')).toBe('08:00')
    expect(copy('9 am pt to cet')).toBe('18:00')
    expect(copy('noon utc to ist')).toBe('17:30')
    expect(copy('5pm in tokyo')).toBe('02:00')
    expect(answer('5pm in tokyo')?.expression).toBe('17:00 → Tokyo')
    expect(copy('10:30 utc+2 to utc')).toBe('08:30')
    expect(copy('8am new york → europe/prague')).toBe('14:00')
  })

  it('follows daylight saving for cities', () => {
    const july = new Date('2026-07-01T12:00:00Z')
    expect(copy('5pm london in new york', { now: july })).toBe('12:00')
    expect(copy('time in london', { now: july })).toBe('13:00')
  })
})

describe('dates', () => {
  it('shifts today', () => {
    expect(answer('in 3 weeks')).toEqual({ kind: 'date', expression: 'Today + 3 weeks', result: 'Thu, 10 Dec 2026', copy: '2026-12-10' })
    expect(copy('3 days ago')).toBe('2026-11-16')
    expect(copy('in a month')).toBe('2026-12-19')
    expect(copy('in 2 years')).toBe('2028-11-19')
    expect(copy('a fortnight from now')).toBe('2026-12-03')
    expect(copy('today + 10 days')).toBe('2026-11-29')
    expect(copy('tomorrow - 1 week')).toBe('2026-11-13')
  })

  it('clamps month ends', () => {
    expect(copy('in 1 month', { now: new Date('2027-01-31T12:00:00Z') })).toBe('2027-02-28')
  })

  it('counts days', () => {
    expect(answer('days until 24 dec')).toEqual({ kind: 'date', expression: 'Days until Thu, 24 Dec 2026', result: '35 days', copy: '35' })
    expect(copy('days until christmas')).toBe('36')
    expect(copy('how many days until new year?')).toBe('43')
    expect(copy('days until dec 24, 2027')).toBe('400')
    expect(copy('days until 1 jan')).toBe('43')
    expect(copy('days until 1 nov')).toBe('347')
    expect(copy('days since 1 jan')).toBe('322')
    expect(copy('days since christmas')).toBe('329')
    expect(copy('days until tomorrow')).toBe('1')
    expect(result('days until tomorrow')).toBe('1 day')
    expect(copy('days until 24.12.')).toBe('35')
    expect(copy('2026-12-24 - today')).toBe('35')
    expect(copy('today - 2026-12-24')).toBe('-35')
    expect(answer('days until 31 feb')).toBeNull()
  })
})

describe('parseNumber', () => {
  it.each([
    ['1,000,000', 'en', 1_000_000],
    ['1,000.5', 'en', 1000.5],
    ['1.000,5', 'en', 1000.5],
    ['1,5', 'en', 1.5],
    ['0,500', 'en', 0.5],
    ['1.000', 'de', 1000],
    ['1,000', 'de', 1],
    ['1.5', 'de', 1.5],
    ['1,00,0', 'en', Number.NaN],
    ['1.2.3', 'en', Number.NaN],
  ])('%s (%s) → %d', (raw, locale, expected) => {
    expect(parseNumber(raw, locale)).toBe(expected)
  })

  it('formats without float noise', () => {
    expect(formatNumber(0.1 + 0.2, 'en')).toBe('0.3')
    expect(formatNumber(-0, 'en')).toBe('0')
  })
})
