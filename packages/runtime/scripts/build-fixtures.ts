/**
 * Builds the test plugins in `fixtures/` the way a plugin build must: ESM
 * with exactly the shared modules external (the import map resolves them),
 * plus a UnoCSS stylesheet over the plugin's own sources.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import presetModoUi from '@justanarthur/modo-ui/unocss'
import { createGenerator, presetWind4 } from 'unocss'
import { SHARED_MODULES } from '../bundler/shared-modules.ts'

const fixtures = join(import.meta.dir, '../fixtures')
const uno = await createGenerator({ presets: [presetWind4({ preflights: { reset: false, theme: 'on-demand' } }), presetModoUi()] })

for (const id of readdirSync(fixtures)) {
  const root = join(fixtures, id)
  const result = await Bun.build({
    entrypoints: [join(root, 'src/index.tsx')],
    outdir: join(root, 'dist'),
    format: 'esm',
    target: 'browser',
    minify: true,
    external: Object.keys(SHARED_MODULES),
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  if (!result.success) throw new AggregateError(result.logs, `${id} failed to build`)
  const source = await Bun.file(join(root, 'src/index.tsx')).text()
  const { css } = await uno.generate(source, { preflights: false })
  await Bun.write(join(root, 'dist/index.css'), css)
  console.log(`built ${id}: ${result.outputs.map((o) => `${o.path.split('/').pop()} ${o.size}B`).join(', ')}, index.css ${css.length}B`)
}
