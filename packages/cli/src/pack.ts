import { mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { zipSync } from 'fflate'
import { buildPlugin, type BuildResult } from './build'
import { loadPlugin, stampedManifest } from './plugin'

export interface PackResult {
  build: BuildResult
  id: string
  version: string
  file: string
  files: string[]
  bytes: number
  sha256: string
}

// The DOS epoch, in local time: fflate stores local date fields, so this is the same bytes in every time zone.
const MTIME = new Date(1980, 0, 1)

/**
 * Builds, then zips manifest.json + dist/ (+ the icon) into `<id>-<version>.notchplugin` in `out`
 * (default: the plugin root). The version comes from package.json, which the release bot bumps, and is
 * stamped into the packed manifest. Entries are sorted and carry a fixed mtime, so equal inputs give equal bytes.
 */
export async function packPlugin(root: string, options: { out?: string } = {}): Promise<PackResult> {
  const build = await buildPlugin(root)
  const manifest = await stampedManifest(root, (await loadPlugin(root)).manifest)
  const { id, version } = manifest

  const dist = (await readdir(join(root, 'dist'), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
  const files = ['manifest.json', ...dist, ...(manifest.icon ? [manifest.icon] : [])].sort()

  const stamped = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
  const entries = Object.fromEntries(
    await Promise.all(
      files.map(
        async (file) =>
          [file, file === 'manifest.json' ? stamped : new Uint8Array(await Bun.file(join(root, file)).arrayBuffer())] as const,
      ),
    ),
  )
  const zip = zipSync(entries, { level: 9, mtime: MTIME })

  const out = resolve(root, options.out ?? '.')
  await mkdir(out, { recursive: true })
  const file = join(out, `${id}-${version}.notchplugin`)
  await Bun.write(file, zip)
  const sha256 = new Bun.CryptoHasher('sha256').update(zip).digest('hex')
  return { build, id, version, file, files, bytes: zip.byteLength, sha256 }
}
