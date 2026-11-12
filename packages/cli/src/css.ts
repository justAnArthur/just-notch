import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import presetModoUi from '@justanarthur/modo-ui/unocss'
import { createGenerator, type Preset } from '@unocss/core'
import presetWind4 from '@unocss/preset-wind4'

const SOURCE = /\.(tsx|ts|mdx)$/

// No reset and no modo-ui base/tokens: the runtime loads those once for every
// plugin. Wind4's on-demand theme vars and @property rules stay, scoped to the
// utilities this plugin uses.
const generator = createGenerator({
  presets: [
    presetWind4({ dark: 'class', preflights: { reset: false, theme: 'on-demand' } }),
    // modo-ui types its preset against the `unocss` meta package, which isn't installed here.
    presetModoUi() as Preset,
  ],
})

export async function sourceFiles(srcDir: string): Promise<string[]> {
  const files = await readdir(srcDir, { recursive: true })
  return files.filter((file) => SOURCE.test(file)).map((file) => join(srcDir, file))
}

/** UnoCSS (wind4 + modo-ui preset) over the plugin's sources; empty when no utility is used. */
export async function generateCss(srcDir: string): Promise<string> {
  const uno = await generator
  const sources = await Promise.all((await sourceFiles(srcDir)).map((file) => Bun.file(file).text()))
  const { css, matched } = await uno.generate(sources.join('\n'), { preflights: true, minify: true })
  return matched.size > 0 ? css : ''
}
