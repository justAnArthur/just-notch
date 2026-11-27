import { type Permission, type PluginManifest, validHostPattern } from '@just-notch/bridge-schema'

/** Every bridge-schema `Permission`; the check below fails to compile when the union grows. */
export const PERMISSIONS = [
  'media.read',
  'media.control',
  'power.read',
  'power.control',
  'screen.read',
  'reminders',
  'network.read',
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
  'apps.read',
  'apps.launch',
  'files.search',
  'net',
  'secrets',
  'windows',
  'hotkeys',
] as const satisfies readonly Permission[]

const exhaustive: [Exclude<Permission, (typeof PERMISSIONS)[number]>] extends [never] ? true : never = true
void exhaustive

const KNOWN_FIELDS = ['id', 'name', 'version', 'description', 'entry', 'style', 'icon', 'permissions', 'hosts', 'defaultEnabled', 'engines']

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

function pathError(field: string, value: unknown, ...extensions: string[]): string | undefined {
  const example = field === 'icon' ? 'icon.png' : `dist/index${extensions[0]}`
  if (typeof value !== 'string' || value === '') return `"${field}" must be a non-empty string`
  if (value.startsWith('/') || value.includes('\\') || value.split('/').some((s) => s === '..' || s === '.'))
    return `"${field}" must be a relative path inside the plugin, like "${example}" (got "${value}")`
  if (!extensions.some((e) => value.endsWith(e))) return `"${field}" must point at a ${extensions.join(' or ')} file (got "${value}")`
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

  const icon = m.icon === undefined ? undefined : pathError('icon', m.icon, '.png', '.svg')
  if (icon) errors.push(icon)

  const permissions = m.permissions
  if (!Array.isArray(permissions)) errors.push('"permissions" must be an array (use [] for none)')
  else {
    const known: readonly unknown[] = PERMISSIONS
    for (const p of permissions)
      if (!known.includes(p)) errors.push(`unknown permission ${JSON.stringify(p)}; allowed: ${PERMISSIONS.join(', ')}`)
    const duplicates = new Set(permissions.filter((p, i) => permissions.indexOf(p) !== i))
    if (duplicates.size > 0) warnings.push(`duplicate permissions: ${[...duplicates].join(', ')}`)
  }

  const hosts = m.hosts
  const net = Array.isArray(permissions) && permissions.includes('net')
  if (hosts !== undefined) {
    if (!Array.isArray(hosts)) errors.push('"hosts" must be an array of hostnames like "api.github.com"')
    else {
      for (const h of hosts)
        if (typeof h !== 'string' || !validHostPattern(h))
          errors.push(
            `invalid host ${JSON.stringify(h)}: use a lowercase hostname like "api.github.com", "*.youtrack.cloud" or "host:8443" (no scheme or path; a wildcard needs two labels after "*.")`,
          )
      if (!net) errors.push('"hosts" needs the "net" permission')
    }
  }
  if (net && (!Array.isArray(hosts) || hosts.length === 0))
    warnings.push('"net" without "hosts": every host must be granted by the user through ctx.net.requestHost')

  const engines = m.engines as Record<string, unknown> | undefined
  if (typeof engines !== 'object' || engines === null || typeof engines.notch !== 'string')
    errors.push('"engines.notch" must be a semver range like "^0.1.0"')
  else if (!isSemverRange(engines.notch)) errors.push(`"engines.notch" is not a semver range (got "${engines.notch}")`)

  if (m.defaultEnabled !== undefined && typeof m.defaultEnabled !== 'boolean') errors.push('"defaultEnabled" must be true or false')
  for (const key of Object.keys(m)) if (!KNOWN_FIELDS.includes(key)) warnings.push(`unknown field "${key}" is ignored`)

  return errors.length > 0 ? { errors, warnings } : { manifest: m as unknown as PluginManifest, errors, warnings }
}
