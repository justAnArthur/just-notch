import { watch } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import * as esbuild from 'esbuild'
import { generateCss } from './css'
import { classifyImport } from './externals'
import { CliError, ENTRY, loadPlugin, STYLE } from './plugin'

const OUTPUTS = [ENTRY, `${ENTRY}.map`, STYLE]

const importMap: esbuild.Plugin = {
  name: 'notch-import-map',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, ({ path }) => {
      const rule = classifyImport(path)
      if (rule.kind === 'external') return { path, external: true }
      if (rule.kind === 'error') return { errors: [{ text: rule.message }] }
    })
  },
}

export interface BuildResult {
  id: string
  ms: number
  jsBytes: number
  cssBytes: number
  warnings: string[]
}

function entryPoint(root: string): string {
  for (const name of ['src/index.tsx', 'src/index.ts']) if (Bun.file(join(root, name)).size > 0) return join(root, name)
  throw new CliError('no src/index.tsx (or src/index.ts) to build')
}

export async function buildPlugin(root: string): Promise<BuildResult> {
  const started = performance.now()
  const { manifest, warnings } = await loadPlugin(root)

  let result: esbuild.BuildResult<{ metafile: true }>
  try {
    result = await esbuild.build({
      absWorkingDir: root,
      entryPoints: [entryPoint(root)],
      outfile: join(root, ENTRY),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      minify: true,
      sourcemap: true,
      metafile: true,
      logLevel: 'silent',
      plugins: [importMap],
    })
  } catch (error) {
    const failure = error as esbuild.BuildFailure
    const messages = await esbuild.formatMessages(failure.errors ?? [], { kind: 'error', color: false })
    throw new CliError(`bundle failed:\n${messages.join('') || failure.message}`)
  }

  const output = Object.values(result.metafile.outputs).find((o) => o.entryPoint)
  if (!output?.exports.includes('default'))
    throw new CliError('src/index.tsx must `export default definePlugin({...})`')

  const css = await generateCss(join(root, 'src'))
  await Bun.write(join(root, STYLE), css)
  if (css !== '' && manifest.style === undefined)
    warnings.push(`the plugin uses utilities but manifest.json has no "style": add "style": "${STYLE}" or the runtime won't load them`)

  const stale = (await readdir(join(root, 'dist'), { recursive: true })).filter((f) => !OUTPUTS.includes(`dist/${f}`))
  await Promise.all(stale.map((f) => rm(join(root, 'dist', f), { recursive: true, force: true })))

  return {
    id: manifest.id,
    ms: Math.round(performance.now() - started),
    jsBytes: Bun.file(join(root, ENTRY)).size,
    cssBytes: Buffer.byteLength(css),
    warnings,
  }
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`
}

export function formatResult(r: BuildResult): string {
  const line = `[notch] ${r.id} built in ${r.ms}ms · index.js ${kb(r.jsBytes)} · index.css ${kb(r.cssBytes)}`
  return [line, ...r.warnings.map((w) => `[notch] warning: ${w}`)].join('\n')
}

export function formatError(error: unknown): string {
  if (error instanceof CliError) return `[notch] error: ${error.message}`
  return `[notch] error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
}

/** Builds once, then rebuilds on every change under src/ or to manifest.json. Resolves never. */
export async function watchPlugin(root: string): Promise<never> {
  await mkdir(join(root, 'src'), { recursive: true })
  let timer: Timer | undefined
  let running = Promise.resolve()

  const rebuild = () => {
    running = running.then(async () => {
      try {
        console.log(formatResult(await buildPlugin(root)))
      } catch (error) {
        console.error(formatError(error))
      }
    })
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(rebuild, 50)
  }

  rebuild()
  watch(join(root, 'src'), { recursive: true }, schedule)
  // Editors and `sed -i` save through a temp file renamed over the manifest.
  watch(root, (_, file) => file?.endsWith('manifest.json') && schedule())
  return new Promise<never>(() => {})
}
