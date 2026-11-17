import type { Permission, PluginManifest } from '@just-notch/bridge-schema'

/** Every bridge-schema `Permission`; the check below fails to compile when the union grows. */
export const PERMISSIONS = [
  'media.read',
  'media.control',
  'power.read',
  'audio.read',
  'audio.control',
  'display.control',
  'hud',
  'calendar.read',
  'files',
  'bluetooth.read',
  'stats.read',
  'weather.read',
  'clipboard',
  'files.recent',
] as const satisfies readonly Permission[]

const exhaustive: [Exclude<Permission, (typeof PERMISSIONS)[number]>] extends [never] ? true : never = true
void exhaustive

const KNOWN_FIELDS = ['id', 'name', 'version', 'description', 'entry', 'style', 'permissions', 'engines']

export const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// semver.org's recommended pattern.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

const PARTIAL = String.raw`v?(?:\d+|[xX*])(?:\.(?:\d+|[xX*]))?(?:\.(?:\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`
const COMPARATOR = new RegExp(`^(?:\\^|~|>=|<=|>|<|=)?${PARTIAL}$`)
const HYPHEN = new RegExp(`^${PARTIAL} - ${PARTIAL}$`)

export function isSemver(value: string): boolean {
  return SEMVER.test(value)
}

/** A node-semver range: `||`-separated sets of comparators, or hyphen ranges. */
export function isSemverRange(value: string): boolean {
  const sets = value.split('||').map((set) => set.trim())
  return sets.every((set) => HYPHEN.test(set) || (set !== '' && set.split(/\s+/).every((c) => COMPARATOR.test(c))))
}

function pathError(field: string, value: unknown, extension: string): string | undefined {
  if (typeof value !== 'string' || value === '') return `"${field}" must be a non-empty string`
  if (value.startsWith('/') || value.includes('\\') || value.split('/').some((s) => s === '..' || s === '.'))
    return `"${field}" must be a relative path inside the plugin, like "dist/index${extension}" (got "${value}")`
  if (!value.endsWith(extension)) return `"${field}" must point at a ${extension} file (got "${value}")`
}

export interface ManifestResult {
  /** Set when `errors` is empty. */
  manifest?: PluginManifest
  errors: string[]
  warnings: string[]
}

/**
 * Validates a parsed `manifest.json` against bridge-schema's `PluginManifest`.
 * Pass `folder` (the plugin folder's name) to require `id` to match it.
 * Pure: no Node or Bun APIs, so the runtime can reuse it.
 */
export function validateManifest(value: unknown, options: { folder?: string } = {}): ManifestResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { errors: ['manifest.json must hold a JSON object'], warnings }

  const m = value as Record<string, unknown>

  if (typeof m.id !== 'string' || !ID.test(m.id)) errors.push(`"id" must be kebab-case like "my-plugin" (got ${JSON.stringify(m.id)})`)
  else if (options.folder !== undefined && m.id !== options.folder)
    errors.push(`"id" is "${m.id}" but the plugin folder is "${options.folder}": they must match`)

  if (typeof m.name !== 'string' || m.name.trim() === '') errors.push('"name" must be a non-empty string')

  if (typeof m.version !== 'string' || !isSemver(m.version))
    errors.push(`"version" must be semver like "0.1.0" (got ${JSON.stringify(m.version)})`)

  if (m.description !== undefined && typeof m.description !== 'string') errors.push('"description" must be a string')

  const entry = pathError('entry', m.entry, '.js')
  if (entry) errors.push(entry)

  const style = m.style === undefined ? undefined : pathError('style', m.style, '.css')
  if (style) errors.push(style)

  const permissions = m.permissions
  if (!Array.isArray(permissions)) errors.push('"permissions" must be an array (use [] for none)')
  else {
    const known: readonly unknown[] = PERMISSIONS
    for (const p of permissions)
      if (!known.includes(p)) errors.push(`unknown permission ${JSON.stringify(p)}; allowed: ${PERMISSIONS.join(', ')}`)
    const duplicates = new Set(permissions.filter((p, i) => permissions.indexOf(p) !== i))
    if (duplicates.size > 0) warnings.push(`duplicate permissions: ${[...duplicates].join(', ')}`)
  }

  const engines = m.engines as Record<string, unknown> | undefined
  if (typeof engines !== 'object' || engines === null || typeof engines.notch !== 'string')
    errors.push('"engines.notch" must be a semver range like "^0.1.0"')
  else if (!isSemverRange(engines.notch)) errors.push(`"engines.notch" is not a semver range (got "${engines.notch}")`)

  for (const key of Object.keys(m)) if (!KNOWN_FIELDS.includes(key)) warnings.push(`unknown field "${key}" is ignored`)

  return errors.length > 0 ? { errors, warnings } : { manifest: m as unknown as PluginManifest, errors, warnings }
}
