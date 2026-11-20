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

/**
 * Why a plugin can't run here, in a buyer's words: either this Just Notch is older than the plugin needs (an app
 * update fixes it), or the plugin was made for an older Just Notch (its next version will).
 */
export function incompatibility(range: string, apiVersion: string): string {
  const lowest = /\d+(\.\d+){0,2}/.exec(range)?.[0]
  const padded = lowest && [...lowest.split('.'), '0', '0'].slice(0, 3).join('.')
  return padded && compareVersions(padded, apiVersion) > 0
    ? 'Needs a newer Just Notch. Update Just Notch to use it.'
    : 'Made for an older Just Notch. It works again once its developer updates it.'
}

/** Whether an incompatible plugin waits on an update of Just Notch itself. */
export const needsAppUpdate = (reason: string) => reason.startsWith('Needs a newer Just Notch')

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
  if (installed.incompatible) return { status: 'incompatible', reason: incompatibility(installed.manifest.engines.notch, apiVersion) }
  return { status: 'installed' }
}

/** How many installed plugins the catalog has a newer, compatible version of. */
export function updateCount(catalog: CatalogEntry[] | undefined, installed: InstalledPlugin[], apiVersion: string): number {
  return (catalog ?? []).filter((entry) => {
    const plugin = installed.find((p) => p.manifest.id === entry.id)
    return plugin && entryState(entry, plugin, apiVersion).status === 'update-available'
  }).length
}


/**
 * The library in two lists: what's installed here, and what can be installed. A plugin that can't run on this
 * Just Notch and isn't installed is set aside (`waiting`) rather than offered.
 */
export function librarySections<T extends { id: string; state: LibraryEntryState }>(entries: T[], installedIds: ReadonlySet<string>) {
  const notInstalled = entries.filter((entry) => !installedIds.has(entry.id))
  return {
    installed: entries.filter((entry) => installedIds.has(entry.id)),
    available: notInstalled.filter((entry) => entry.state.status !== 'incompatible'),
    waiting: notInstalled.filter((entry) => entry.state.status === 'incompatible'),
  }
}
