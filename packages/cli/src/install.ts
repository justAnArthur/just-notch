import { cp, mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildPlugin, type BuildResult, watchPlugin } from './build'
import { loadPlugin, stampedManifest } from './plugin'

/** The app's user plugin folder (`Paths.userPlugins` in the Swift host). */
export function userPluginsDir(): string {
  return join(homedir(), 'Library/Application Support/JustNotch/Plugins')
}

/** Copies the built plugin (manifest.json, dist/, the icon) to `<plugins>/<id>`, replacing what was there. */
export async function copyPlugin(root: string, plugins = userPluginsDir()): Promise<string> {
  const manifest = await stampedManifest(root, (await loadPlugin(root)).manifest)
  const dest = join(plugins, manifest.id)
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  await Bun.write(join(dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await cp(join(root, 'dist'), join(dest, 'dist'), { recursive: true })
  if (manifest.icon) {
    await mkdir(dirname(join(dest, manifest.icon)), { recursive: true })
    await cp(join(root, manifest.icon), join(dest, manifest.icon))
  }
  return dest
}

/** Builds, then copies into the user plugin folder. */
export async function installPlugin(root: string, plugins = userPluginsDir()): Promise<{ build: BuildResult; dir: string }> {
  const build = await buildPlugin(root)
  return { build, dir: await copyPlugin(root, plugins) }
}

/** `installPlugin` again after every rebuild. Resolves never. */
export function watchInstall(root: string, plugins = userPluginsDir()): Promise<never> {
  return watchPlugin(root, async () => {
    console.log(`[notch] installed ${await copyPlugin(root, plugins)}`)
  })
}
