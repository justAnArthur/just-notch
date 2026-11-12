import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'vite'
import { DEV_SHARED_MODULES, SHARED_MODULES } from './shared-modules.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const PREFIX = 'notch-shared:'

// CommonJS packages: their names can't be re-exported with `export *`, so read them once at build time.
const COMMONJS = new Set(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'])

function entry(spec: string) {
  if (!COMMONJS.has(spec)) return `export * from '${spec}'\n`
  const names = Object.keys(require(spec)).filter((name) => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name))
  return `import m from '${spec}'\nexport default m\nexport const { ${names.join(', ')} } = m\n`
}

const entries: Plugin = {
  name: 'notch:shared-entries',
  resolveId: (id) => (id.startsWith(PREFIX) ? `\0${id}` : null),
  load: (id) => (id.startsWith(`\0${PREFIX}`) ? entry(id.slice(PREFIX.length + 1)) : null),
}

/**
 * Builds every shared module in ONE build, so React, motion and the SDK each
 * exist once: entries are `<file>.js`, the code they share lands in `chunks/`.
 */
export async function buildShared(outDir: string, mode: 'development' | 'production') {
  const modules = mode === 'development' ? DEV_SHARED_MODULES : SHARED_MODULES
  process.env.NODE_ENV = mode
  await build({
    configFile: false,
    root,
    mode,
    logLevel: 'warn',
    plugins: [entries],
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    build: {
      outDir,
      emptyOutDir: true,
      copyPublicDir: false,
      modulePreload: false,
      minify: mode === 'production',
      reportCompressedSize: false,
      chunkSizeWarningLimit: 2048,
      rolldownOptions: {
        input: Object.fromEntries(Object.entries(modules).map(([spec, file]) => [file.replace(/\.js$/, ''), PREFIX + spec])),
        preserveEntrySignatures: 'strict',
        // Base UI marks its modules 'use client'; there are no server components here.
        onwarn: (warning, warn) => warning.code === 'MODULE_LEVEL_DIRECTIVE' || warn(warning),
        output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name].js' },
      },
    },
  })
}
