import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PluginManifest } from '@just-notch/bridge-schema'
import { findMonorepo } from './create'
import { loadPlugin, readPackage } from './plugin'

function tscPath(root: string): string {
  try {
    return Bun.resolveSync('typescript/bin/tsc', root)
  } catch {
    return Bun.resolveSync('typescript/bin/tsc', dirname(import.meta.dir))
  }
}

function scopes(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * Release rules for `library/<id>`, which is versioned and tagged on its own (`@just-notch/plugin-<id>@x.y.z`).
 * Empty for plugins outside a monorepo's library/.
 */
export async function libraryProblems(root: string, manifest: PluginManifest): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = []
  const warnings: string[] = []
  const repo = findMonorepo(root)
  if (!repo || dirname(root) !== join(repo, 'library')) return { errors, warnings }

  const id = manifest.id
  const pkg = await readPackage(root)
  if (!pkg) return { errors: ['library plugins need a package.json: its version is the release version'], warnings }

  const name = `@just-notch/plugin-${id}`
  if (pkg.name !== name) errors.push(`package.json "name" must be "${name}": the release tag and its workflow map back to library/${id} through it`)
  if (existsSync(join(repo, 'plugins', id))) errors.push(`id "${id}" is taken by plugins/${id}`)

  const own = pkg.properties?.gitCommitScopeRelatedNames
  if (!own) errors.push(`package.json needs "properties": { "gitCommitScopeRelatedNames": "${id}" }, or commits never release it`)
  else if (!scopes(own).includes(id)) warnings.push(`package.json gitCommitScopeRelatedNames ("${own}") doesn't list "${id}"`)
  if (scopes((await readPackage(repo))?.properties?.gitCommitScopeRelatedNames).includes(id))
    errors.push(`"${id}" is in the root package.json's gitCommitScopeRelatedNames: its commits would release the app too`)

  if (pkg.version !== manifest.version)
    warnings.push(`manifest.json version ${manifest.version} differs from package.json ${pkg.version}; notch pack stamps the package.json one`)
  return { errors, warnings }
}

/** Manifest validation, library release rules, then `tsc --noEmit` in the plugin. Exit code 1 on rule errors, else tsc's. */
export async function checkPlugin(root: string): Promise<{ errors: string[]; warnings: string[]; exitCode: number }> {
  const { manifest, warnings } = await loadPlugin(root)
  const library = await libraryProblems(root, manifest)
  warnings.push(...library.warnings)
  const tsc = Bun.spawn([process.execPath, tscPath(root), '--noEmit', '-p', join(root, 'tsconfig.json')], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await tsc.exited
  return { errors: library.errors, warnings, exitCode: library.errors.length > 0 ? 1 : exitCode }
}
