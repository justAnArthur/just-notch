import { describe, expect, test } from 'bun:test'
import { API_VERSION, compareVersions, satisfies } from '../src/index'
import cases from './semver-cases.json'

// The Swift host runs the same cases (apps/macos/Packages/NotchServices/Tests, SemverTests).

describe('compareVersions', () => {
  test.each(cases.compare as [string, string, number][])('%p vs %p: %p', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected as -1 | 0 | 1)
    expect(compareVersions(b, a)).toBe((expected === 0 ? 0 : -expected) as -1 | 0 | 1)
  })
})

describe('satisfies', () => {
  test.each(cases.satisfies as [string, string, boolean][])('%p in %p: %p', (version, range, expected) =>
    expect(satisfies(version, range)).toBe(expected),
  )

  test('the API version satisfies what built-in and library plugins declare', () => {
    expect(satisfies(API_VERSION, '^1.0.0')).toBe(true)
    expect(satisfies(API_VERSION, '^1.1.0')).toBe(true)
    expect(satisfies(API_VERSION, '^0.1.0')).toBe(false)
  })
})
