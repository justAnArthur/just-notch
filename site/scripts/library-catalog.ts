/**
 * Writes the library catalog the app reads (bridge-schema `LibraryCatalog`) to public/library/index.json,
 * with each plugin's icon and screenshots beside it.
 *
 *   bun scripts/library-catalog.ts           releases on GitHub (gh api, GH_TOKEN)
 *   bun scripts/library-catalog.ts --local   packs library/* in place instead, for a preview
 *
 * For each library/<id>, the newest stable `@just-notch/plugin-<id>@x.y.z` release with a `<id>-x.y.z.notchplugin`.
 * Everything the app checks comes from that released file (never from HEAD): its manifest, size and SHA-256.
 * Only the icon fallback and the screenshots come from library/<id>/assets/.
 *
 * Env: GITHUB_REPOSITORY (default justAnArthur/just-notch), LIBRARY_BASE_URL (where the site is served,
 * default https://justanarthur.github.io/just-notch/).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
// Types only (erased at runtime), so the site stays outside the workspace.
import type { LibraryCatalog, LibraryEntry, PluginManifest } from '../../packages/bridge-schema/src/index'

export const DEFAULT_BASE = 'https://justanarthur.github.io/just-notch/'
const DEFAULT_REPO = 'justAnArthur/just-notch'

export interface ReleaseAsset {
  name: string
  browser_download_url: string
}

/** The fields of the REST releases API this needs. */
export interface Release {
  tag_name: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
  assets: ReleaseAsset[]
}

export interface CatalogOptions {
  /** The repo checkout, holding library/. */
  repoRoot: string
  /** Written fresh: index.json and <id>/ (icon, screenshots). */
  outDir: string
  /** The site's absolute URL, ending in `/`. */
  base: string
  /** `owner/name`. */
  repo: string
  releases: Release[]
  fetchBytes(url: string): Promise<Uint8Array>
  now?: Date
}

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/

export function compareVersions(a: string, b: string) {
  const x = a.match(STABLE)!.slice(1).map(Number)
  const y = b.match(STABLE)!.slice(1).map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!
  return 0
}

/** The newest stable release of `id` that carries its `.notchplugin`. */
export function latestRelease(id: string, releases: Release[]) {
  const prefix = `@just-notch/plugin-${id}@`
  return releases
    .filter((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(prefix))
    .map((release) => {
      const version = release.tag_name.slice(prefix.length)
      return { release, version, asset: release.assets.find((a) => a.name === `${id}-${version}.notchplugin`) }
    })
    .filter((c): c is typeof c & { asset: ReleaseAsset } => STABLE.test(c.version) && c.asset !== undefined)
    .sort((a, b) => compareVersions(b.version, a.version))[0]
}

export function libraryIds(repoRoot: string) {
  const dir = join(repoRoot, 'library')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort()
}

const unzip = (file: string, entry: string) => execFileSync('unzip', ['-p', file, entry], { maxBuffer: 64 << 20 })

export async function buildCatalog(options: CatalogOptions): Promise<LibraryCatalog> {
  const { repoRoot, outDir, base, repo, releases, fetchBytes } = options
  const downloads = `https://github.com/${repo}/releases/download/`
  const work = mkdtempSync(join(tmpdir(), 'library-catalog-'))
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const plugins: LibraryEntry[] = []
  try {
    for (const id of libraryIds(repoRoot)) {
      const latest = latestRelease(id, releases)
      if (!latest) {
        console.log(`${id}: no stable release with ${id}-x.y.z.notchplugin yet, skipped`)
        continue
      }
      const { release, version, asset } = latest
      const url = asset.browser_download_url
      // The app installs only from this prefix.
      if (!url.startsWith(downloads)) throw new Error(`${id}: ${url} is not under ${downloads}`)

      const bytes = await fetchBytes(url)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const sum = release.assets.find((a) => a.name === `${asset.name}.sha256`)
      if (sum) {
        const expected = new TextDecoder().decode(await fetchBytes(sum.browser_download_url)).trim().split(/\s+/)[0]
        if (expected !== sha256) throw new Error(`${id}: ${asset.name} hashes to ${sha256}, its .sha256 says ${expected}`)
      }

      const zip = join(work, asset.name)
      writeFileSync(zip, bytes)
      const manifest = JSON.parse(unzip(zip, 'manifest.json').toString('utf8')) as PluginManifest & { author?: string }
      if (manifest.id !== id || manifest.version !== version)
        throw new Error(`${id}: ${release.tag_name} packs ${manifest.id}@${manifest.version}`)

      const dest = join(outDir, id)
      mkdirSync(dest, { recursive: true })
      const assets = join(repoRoot, 'library', id, 'assets')
      const at = (path: string) => new URL(`library/${id}/${path}`, base).href

      let icon: string | undefined
      if (manifest.icon) {
        icon = `icon${extname(manifest.icon)}`
        writeFileSync(join(dest, icon), unzip(zip, manifest.icon))
      } else {
        const fallback = ['icon.svg', 'icon.png'].find((name) => existsSync(join(assets, name)))
        if (fallback) copyFileSync(join(assets, fallback), join(dest, (icon = fallback)))
      }

      const shots = join(assets, 'screenshots')
      const screenshots = existsSync(shots) ? readdirSync(shots).filter((f) => f.endsWith('.png')).sort() : []
      if (screenshots.length) mkdirSync(join(dest, 'screenshots'))
      for (const shot of screenshots) copyFileSync(join(shots, shot), join(dest, 'screenshots', shot))

      plugins.push({
        id,
        name: manifest.name,
        ...(manifest.description && { description: manifest.description }),
        version,
        engines: manifest.engines,
        permissions: manifest.permissions,
        hosts: manifest.hosts ?? [],
        // Only the maintainer publishes for now.
        author: manifest.author ?? repo.split('/')[0]!,
        source: `https://github.com/${repo}/tree/main/library/${id}`,
        download: { url, sha256, size: bytes.byteLength },
        ...(icon && { icon: at(icon) }),
        screenshots: screenshots.map((s) => at(`screenshots/${s}`)),
        releasedAt: release.published_at ?? (options.now ?? new Date()).toISOString(),
      })
      console.log(`${id}: ${version} (${bytes.byteLength} bytes, ${sha256.slice(0, 12)}…)`)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }

  const catalog: LibraryCatalog = { schema: 1, generatedAt: (options.now ?? new Date()).toISOString(), plugins }
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(catalog, null, 2)}\n`)
  return catalog
}

function githubReleases(repo: string): Release[] {
  const out = execFileSync(
    'gh',
    [
      'api',
      `repos/${repo}/releases?per_page=100`,
      '--paginate',
      '--jq',
      '.[] | {tag_name, draft, prerelease, published_at, assets: [.assets[] | {name, browser_download_url}]}',
    ],
    { encoding: 'utf8', maxBuffer: 64 << 20 },
  )
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Release)
}

async function download(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Packs every library/<id> as it is now and stands each up as a release at its would-be GitHub URL. */
function localReleases(repoRoot: string, repo: string, work: string) {
  const files = new Map<string, string>()
  const releases = libraryIds(repoRoot).map((id): Release => {
    const out = execFileSync('bun', ['packages/cli/src/cli.ts', 'pack', '--cwd', `library/${id}`, '--out', work, '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const packed = JSON.parse(out.slice(out.indexOf('{'))) as { version: string; file: string }
    const tag = `@just-notch/plugin-${id}@${packed.version}`
    const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${basename(packed.file)}`
    files.set(url, packed.file)
    return { tag_name: tag, draft: false, prerelease: false, published_at: null, assets: [{ name: basename(packed.file), browser_download_url: url }] }
  })
  return { releases, fetchBytes: async (url: string) => new Uint8Array(readFileSync(files.get(url)!)) }
}

if (import.meta.main) {
  const site = resolve(import.meta.dirname, '..')
  const repoRoot = resolve(site, '..')
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO
  const base = (process.env.LIBRARY_BASE_URL || DEFAULT_BASE).replace(/\/?$/, '/')
  const work = mkdtempSync(join(tmpdir(), 'library-pack-'))
  try {
    const source = process.argv.includes('--local')
      ? localReleases(repoRoot, repo, work)
      : { releases: githubReleases(repo), fetchBytes: download }
    const catalog = await buildCatalog({ repoRoot, outDir: join(site, 'public/library'), base, repo, ...source })
    console.log(`library/index.json: ${catalog.plugins.length} plugin(s)`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
