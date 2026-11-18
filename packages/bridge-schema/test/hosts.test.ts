import { describe, expect, test } from 'bun:test'
import { hostAllowed, isLocalHost, netHostKey, netResponseType, netSchemeAllowed, netTimeout, validHostPattern } from '../src/index'
import cases from './host-cases.json'

// The Swift host runs the same cases (apps/macos/Packages/NotchServices/Tests, HostPatternTests).

describe('validHostPattern', () => {
  test.each(cases.valid)('accepts %p', (pattern) => expect(validHostPattern(pattern)).toBe(true))
  test.each(cases.invalid)('rejects %p', (pattern) => expect(validHostPattern(pattern)).toBe(false))
})

describe('hostAllowed', () => {
  test.each(cases.allowed as [string[], string, boolean][])('%p allows %p: %p', (patterns, url, expected) =>
    expect(hostAllowed(patterns, url)).toBe(expected),
  )
})

describe('local hosts and schemes', () => {
  test.each(cases.local as [string, boolean][])('%p is local: %p', (host, expected) => expect(isLocalHost(host)).toBe(expected))
  test.each(cases.scheme as [string, boolean][])('%p: %p', (url, expected) => expect(netSchemeAllowed(new URL(url))).toBe(expected))
})

describe('net helpers', () => {
  test('host key keeps a non-default port', () => {
    expect(netHostKey(new URL('https://YouTrack.Acme.com/x'))).toBe('youtrack.acme.com')
    expect(netHostKey(new URL('https://host:8443/x'))).toBe('host:8443')
  })

  test('timeout is clamped', () => {
    expect(netTimeout(undefined)).toBe(15_000)
    expect(netTimeout(10)).toBe(1_000)
    expect(netTimeout(120_000)).toBe(60_000)
  })

  test('response type follows the content type', () => {
    expect(netResponseType('application/json; charset=utf-8')).toBe('text')
    expect(netResponseType('application/vnd.api+json')).toBe('text')
    expect(netResponseType('text/html')).toBe('text')
    expect(netResponseType('application/atom+xml')).toBe('text')
    expect(netResponseType('image/png')).toBe('base64')
    expect(netResponseType(undefined)).toBe('base64')
  })
})
