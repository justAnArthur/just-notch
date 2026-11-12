import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { PluginManifest } from '@just-notch/bridge-schema'
import { validateManifest } from './manifest'

export const ENTRY = 'dist/index.js'
export const STYLE = 'dist/index.css'

export class CliError extends Error {}

export interface Plugin {
  root: string
  manifest: PluginManifest
  warnings: string[]
}

/** Reads and validates `<root>/manifest.json`; throws a `CliError` listing every problem. */
export async function loadPlugin(root: string): Promise<Plugin> {
  const path = join(root, 'manifest.json')
  if (!existsSync(path)) throw new CliError(`no manifest.json in ${root} (run inside a plugin folder or pass --cwd)`)

  let json: unknown
  try {
    json = JSON.parse(await Bun.file(path).text())
  } catch (error) {
    throw new CliError(`manifest.json is not valid JSON: ${(error as Error).message}`)
  }

  const { manifest, errors, warnings } = validateManifest(json, { folder: basename(root) })
  if (manifest?.entry !== undefined && manifest.entry !== ENTRY)
    errors.push(`"entry" must be "${ENTRY}": that is where notch build writes the bundle (got "${manifest.entry}")`)
  if (manifest?.style !== undefined && manifest.style !== STYLE)
    errors.push(`"style" must be "${STYLE}" or absent: that is where notch build writes the CSS (got "${manifest.style}")`)

  if (!manifest || errors.length > 0) throw new CliError(`manifest.json is invalid:\n${errors.map((e) => `  - ${e}`).join('\n')}`)
  return { root, manifest, warnings }
}
