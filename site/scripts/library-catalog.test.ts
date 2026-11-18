import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCatalog, compareVersions, latestRelease, type Release } from './library-catalog'

const RELEASES = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/releases.json'), 'utf8')) as Release[]
const BASE = 'https://example.test/just-notch/'
const URL_0_10 = RELEASES.find((r) => r.tag_name.endsWith('@0.10.0'))!.assets[0]!.browser_download_url
const ICON = '<svg xmlns="http://www.w3.org/2000/svg"/>'

let root: string

/** A .notchplugin as `notch pack` lays it out: manifest.json, dist/, the icon. */
function pack(manifest: object) {
  const dir = mkdtempSync(join(root, 'pack-'))
  mkdirSync(join(dir, 'dist'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(dir, 'dist/index.js'), 'export default {}\n')
  writeFileSync(join(dir, 'assets/icon.svg'), ICON)
  execFileSync('zip', ['-qrX', 'out.zip', 'manifest.json', 'dist', 'assets'], { cwd: dir })
  return new Uint8Array(readFileSync(join(dir, 'out.zip')))
}

const MANIFEST = {
  id: 'demo',
  name: 'Demo',
  version: '0.10.0',
  description: 'A demo.',
  entry: 'dist/index.js',
  icon: 'assets/icon.svg',
  permissions: ['net'],
  hosts: ['api.example.com'],
  engines: { notch: '^1.1.0' },
}

function run(zip: Uint8Array, sum?: string) {
  const sha = sum ?? createHash('sha256').update(zip).digest('hex')
  const files: Record<string, Uint8Array> = {
    [URL_0_10]: zip,
    [`${URL_0_10}.sha256`]: new TextEncoder().encode(`${sha}  demo-0.10.0.notchplugin\n`),
  }
  return buildCatalog({
    repoRoot: root,
    outDir: join(root, 'out'),
    base: BASE,
    repo: 'justAnArthur/just-notch',
    releases: RELEASES,
    fetchBytes: async (url) => files[url] ?? Promise.reject(new Error(`unexpected download ${url}`)),
    now: new Date('2026-11-18T00:00:00Z'),
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'library-catalog-test-'))
  mkdirSync(join(root, 'library/demo/assets/screenshots'), { recursive: true })
  writeFileSync(join(root, 'library/demo/manifest.json'), '{}')
  writeFileSync(join(root, 'library/demo/assets/screenshots/b.png'), 'b')
  writeFileSync(join(root, 'library/demo/assets/screenshots/a.png'), 'a')
  writeFileSync(join(root, 'library/README.md'), '')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('latestRelease', () => {
  test('the newest stable release with its .notchplugin, numerically', () => {
    expect(latestRelease('demo', RELEASES)?.version).toBe('0.10.0')
  })

  test('another plugin with a longer id is not this one', () => {
    expect(latestRelease('demo-extra', RELEASES)?.version).toBe('9.0.0')
    expect(latestRelease('dem', RELEASES)).toBeUndefined()
  })

  test('compareVersions', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })
})

describe('buildCatalog', () => {
  test('an entry from the released manifest, with absolute URLs', async () => {
    const zip = pack(MANIFEST)
    const catalog = await run(zip)
    expect(catalog).toEqual({
      schema: 1,
      generatedAt: '2026-11-18T00:00:00.000Z',
      plugins: [
        {
          id: 'demo',
          name: 'Demo',
          description: 'A demo.',
          version: '0.10.0',
          engines: { notch: '^1.1.0' },
          permissions: ['net'],
          hosts: ['api.example.com'],
          author: 'justAnArthur',
          source: 'https://github.com/justAnArthur/just-notch/tree/main/library/demo',
          download: { url: URL_0_10, sha256: createHash('sha256').update(zip).digest('hex'), size: zip.byteLength },
          icon: `${BASE}library/demo/icon.svg`,
          screenshots: [`${BASE}library/demo/screenshots/a.png`, `${BASE}library/demo/screenshots/b.png`],
          releasedAt: '2026-11-07T00:00:00Z',
        },
      ],
    })
    const out = join(root, 'out')
    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))).toEqual(catalog)
    expect(readFileSync(join(out, 'demo/icon.svg'), 'utf8')).toBe(ICON)
    expect(existsSync(join(out, 'demo/screenshots/a.png'))).toBe(true)
  })

  test('a hash that disagrees with the .sha256 asset fails', async () => {
    await expect(run(pack(MANIFEST), '0'.repeat(64))).rejects.toThrow('.sha256 says')
  })

  test('a packed manifest that is not the tagged version fails', async () => {
    await expect(run(pack({ ...MANIFEST, version: '0.9.0' }))).rejects.toThrow('packs demo@0.9.0')
  })

  test('no releases: an empty catalog', async () => {
    const catalog = await buildCatalog({
      repoRoot: root,
      outDir: join(root, 'out'),
      base: BASE,
      repo: 'justAnArthur/just-notch',
      releases: [],
      fetchBytes: () => Promise.reject(new Error('no downloads')),
    })
    expect(catalog.plugins).toEqual([])
    expect(JSON.parse(readFileSync(join(root, 'out/index.json'), 'utf8')).plugins).toEqual([])
  })
})
