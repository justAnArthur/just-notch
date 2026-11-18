import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { netProxy } from './net-proxy.ts'
import { type PluginRoot, servePlugins, serveDir } from './plugin-files.ts'
import { buildShared } from './shared-build.ts'
import { DEV_SHARED_MODULES, importMap, SHARED_BASE, SHARED_MODULES } from './shared-modules.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const repo = resolve(root, '../..')
const sdkSource = join(repo, 'packages/sdk/src')
const pluginRoots: PluginRoot[] = [
  { dir: join(repo, 'plugins'), builtIn: true },
  { dir: join(repo, 'library'), builtIn: false },
  ...(process.env.NOTCH_FIXTURES === '1' ? [{ dir: join(root, 'fixtures'), builtIn: true }] : []),
]

/**
 * One instance of each shared module for the runtime and every plugin:
 * - build: the runtime keeps bare imports of the shared specifiers (resolved by
 *   the import map) and `dist/shared/` is built after the app;
 * - dev: the shared modules are built once into Vite's cache and served raw at
 *   `/shared/`, and the runtime's own imports are rewritten to those URLs (Vite
 *   would otherwise point them at its own pre-bundled copies).
 * Both: the import map at the top of every page, workspace plugins at `/plugins/`.
 */
export default function notchRuntime(): Plugin {
  let command: 'serve' | 'build' = 'serve'
  let sharedDir = ''

  return {
    name: 'notch:runtime',
    enforce: 'pre',
    config: () => ({
      optimizeDeps: { noDiscovery: true, include: [] },
      build: { rolldownOptions: { external: Object.keys(SHARED_MODULES) } },
    }),
    configResolved(config) {
      command = config.command
      sharedDir = command === 'serve' ? join(config.cacheDir, 'notch-shared') : join(config.build.outDir, 'shared')
    },
    resolveId(id) {
      if (command === 'build') return id in SHARED_MODULES ? { id, external: true } : null
      if (id in DEV_SHARED_MODULES) return SHARED_BASE + DEV_SHARED_MODULES[id as keyof typeof DEV_SHARED_MODULES]
      return id.startsWith(SHARED_BASE) ? id : null
    },
    load(id) {
      if (command === 'serve' && id.startsWith(SHARED_BASE)) return readFileSync(join(sharedDir, id.slice(SHARED_BASE.length)), 'utf8')
    },
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(
          '<head>',
          `<head>\n    <script type="importmap">${JSON.stringify(importMap(command === 'serve' ? DEV_SHARED_MODULES : SHARED_MODULES))}</script>`,
        ),
    },
    async configureServer(server) {
      await buildShared(sharedDir, 'development')
      server.watcher.add(sdkSource)
      server.watcher.on('change', async (file) => {
        if (!file.startsWith(sdkSource)) return
        await buildShared(sharedDir, 'development')
        server.ws.send({ type: 'full-reload' })
      })
      server.middlewares.use(SHARED_BASE, serveDir(() => sharedDir))
      server.middlewares.use('/plugins', servePlugins(pluginRoots))
      server.middlewares.use('/__notch/net', netProxy(pluginRoots))
    },
    configurePreviewServer(server) {
      server.middlewares.use('/plugins', servePlugins(pluginRoots))
    },
    async closeBundle() {
      if (command === 'build') await buildShared(sharedDir, 'production')
    },
  }
}
