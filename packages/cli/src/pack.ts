import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { buildPlugin, type BuildResult } from './build'
import { loadPlugin } from './plugin'

export interface PackResult {
  build: BuildResult
  file: string
  files: string[]
  bytes: number
}

/** Builds, then zips manifest.json + dist/ into `<id>-<version>.notchplugin` at the plugin root. */
export async function packPlugin(root: string): Promise<PackResult> {
  const build = await buildPlugin(root)
  const { manifest } = await loadPlugin(root)

  const dist = (await readdir(join(root, 'dist'), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
  const files = ['manifest.json', ...dist.sort()]

  const entries = Object.fromEntries(
    await Promise.all(files.map(async (file) => [file, new Uint8Array(await Bun.file(join(root, file)).arrayBuffer())] as const)),
  )
  const zip = zipSync(entries, { level: 9 })
  const file = join(root, `${manifest.id}-${manifest.version}.notchplugin`)
  await Bun.write(file, zip)
  return { build, file, files, bytes: zip.byteLength }
}
