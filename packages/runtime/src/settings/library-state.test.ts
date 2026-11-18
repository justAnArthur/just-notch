import type { InstalledPlugin, LibraryEntry } from '@just-notch/bridge-schema'
import { describe, expect, test } from 'vitest'
import { entryState, updateCount } from './library-state'

const entry = (version: string, notch = '^1.1.0'): LibraryEntry => ({
  id: 'github',
  name: 'GitHub',
  version,
  engines: { notch },
  permissions: ['net', 'secrets'],
  hosts: ['api.github.com'],
  source: 'https://github.com/justAnArthur/just-notch/tree/main/library/github',
  download: { url: 'https://github.com/justAnArthur/just-notch/releases/download/x/github-0.1.0.notchplugin', sha256: '0'.repeat(64), size: 1 },
  screenshots: [],
  releasedAt: '2026-11-18T00:00:00Z',
})

const installed = (version: string, incompatible?: string): InstalledPlugin => ({
  manifest: { id: 'github', name: 'GitHub', version, entry: 'dist/index.js', permissions: ['net', 'secrets'], engines: { notch: '^1.1.0' } },
  baseUrl: 'notch://app/plugins/github/',
  enabled: true,
  builtIn: false,
  source: 'library',
  ...(incompatible && { incompatible }),
})

describe('entryState', () => {
  test('not installed, or incompatible with this API', () => {
    expect(entryState(entry('0.1.0'), undefined, '1.1.0')).toEqual({ status: 'not-installed' })
    expect(entryState(entry('0.1.0', '^2.0.0'), undefined, '1.1.0')).toEqual({
      status: 'incompatible',
      reason: 'Needs plugin API ^2.0.0; this Just Notch has 1.1.0.',
    })
  })

  test('installed, or behind the library', () => {
    expect(entryState(entry('0.1.0'), installed('0.1.0'), '1.1.0')).toEqual({ status: 'installed' })
    expect(entryState(entry('0.1.0'), installed('0.2.0'), '1.1.0')).toEqual({ status: 'installed' })
    expect(entryState(entry('0.10.0'), installed('0.9.0'), '1.1.0')).toEqual({ status: 'update-available', from: '0.9.0', to: '0.10.0' })
  })

  test('an update this Just Notch can’t run is no update', () => {
    expect(entryState(entry('0.2.0', '^2.0.0'), installed('0.1.0'), '1.1.0')).toEqual({ status: 'installed' })
  })

  test('an incompatible install with a compatible update offers the update', () => {
    expect(entryState(entry('0.2.0'), installed('0.1.0', 'old'), '1.1.0')).toMatchObject({ status: 'update-available' })
    expect(entryState(entry('0.1.0'), installed('0.1.0', 'old'), '1.1.0')).toEqual({ status: 'incompatible', reason: 'old' })
  })

  test('an install under way wins, then a failure', () => {
    expect(entryState(entry('0.1.0'), undefined, '1.1.0', { id: 'github', phase: 'downloading', progress: 0.5 })).toEqual({
      status: 'installing',
      progress: 0.4,
      phase: 'Downloading',
    })
    expect(entryState(entry('0.1.0'), undefined, '1.1.0', { id: 'github', phase: 'verifying' })).toMatchObject({ phase: 'Verifying' })
    expect(entryState(entry('0.1.0'), installed('0.1.0'), '1.1.0', undefined, 'checksum mismatch')).toEqual({ status: 'error', message: 'checksum mismatch' })
  })
})

test('updateCount counts installed plugins behind the library', () => {
  expect(updateCount(undefined, [installed('0.1.0')], '1.1.0')).toBe(0)
  expect(updateCount([entry('0.2.0')], [installed('0.1.0')], '1.1.0')).toBe(1)
  expect(updateCount([entry('0.2.0')], [], '1.1.0')).toBe(0)
})
