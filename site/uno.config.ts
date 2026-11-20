import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import presetModoUi, { modoUiContent } from '@justanarthur/modo-ui/unocss'
import { defineConfig, presetWind4 } from 'unocss'

// modo-ui and the notch kit ship as class names: their built JS goes to UnoCSS beside the site's own.
const KIT = join(import.meta.dirname, 'node_modules/@justanarthur/modo-ui-notch/dist')
const kitContent = () =>
  readdirSync(KIT, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(join(KIT, file), 'utf8'))
    .join('\n')

export default defineConfig({
  presets: [presetWind4({ dark: 'class' }), presetModoUi()],
  content: { inline: [modoUiContent, kitContent] },
})
