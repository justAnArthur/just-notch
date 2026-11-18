import { compareVersions, type Events, type InstalledPlugin, type LibraryEntry as CatalogEntry, satisfies } from '@just-notch/bridge-schema'
import type { LibraryEntryState } from '@justanarthur/modo-ui-notch'

export type Progress = Events['library.progress']

const PHASE: Record<Progress['phase'], string> = {
  downloading: 'Downloading',
  verifying: 'Verifying',
  installing: 'Installing',
  done: 'Installing',
  error: 'Installing',
}

/** The bar: downloading fills most of it, checking and swapping in the rest. */
function share({ phase, progress = 0 }: Progress): number {
  return phase === 'downloading' ? progress * 0.8 : phase === 'verifying' ? 0.85 : 0.95
}

const incompatibility = (range: string, apiVersion: string) => `Needs plugin API ${range}; this Just Notch has ${apiVersion}.`

/** Where a catalog plugin stands here, from what's installed, the host's API version and any install under way. */
export function entryState(
  entry: CatalogEntry,
  installed: InstalledPlugin | undefined,
  apiVersion: string,
  progress?: Progress,
  failure?: string,
): LibraryEntryState {
  if (progress && progress.phase !== 'done' && progress.phase !== 'error') return { status: 'installing', progress: share(progress), phase: PHASE[progress.phase] }
  if (failure) return { status: 'error', message: failure }
  const compatible = satisfies(apiVersion, entry.engines.notch)
  if (!installed) return compatible ? { status: 'not-installed' } : { status: 'incompatible', reason: incompatibility(entry.engines.notch, apiVersion) }
  if (compatible && compareVersions(entry.version, installed.manifest.version) > 0)
    return { status: 'update-available', from: installed.manifest.version, to: entry.version }
  if (installed.incompatible) return { status: 'incompatible', reason: installed.incompatible }
  return { status: 'installed' }
}

/** How many installed plugins the catalog has a newer, compatible version of. */
export function updateCount(catalog: CatalogEntry[] | undefined, installed: InstalledPlugin[], apiVersion: string): number {
  return (catalog ?? []).filter((entry) => {
    const plugin = installed.find((p) => p.manifest.id === entry.id)
    return plugin && entryState(entry, plugin, apiVersion).status === 'update-available'
  }).length
}

