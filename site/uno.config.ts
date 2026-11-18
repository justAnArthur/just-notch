import presetModoUi, { modoUiContent } from '@justanarthur/modo-ui/unocss'
import { defineConfig, presetWind4 } from 'unocss'

// modo-ui's components ship as class names: modoUiContent hands them to UnoCSS beside the site's own.
export default defineConfig({
  presets: [presetWind4({ dark: 'class' }), presetModoUi()],
  content: { inline: [modoUiContent] },
})
