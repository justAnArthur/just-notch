import presetModoUi from '@justanarthur/modo-ui/unocss'
import { defineConfig, presetWind4 } from 'unocss'

// modo-ui's own components come prebuilt in its styles.css; this generates the runtime's utilities.
export default defineConfig({
  presets: [presetWind4({ dark: 'class', preflights: { reset: false, theme: 'on-demand' } }), presetModoUi()],
  theme: { colors: { island: 'var(--island)' } },
  content: { pipeline: { include: [/\.(tsx?|html)($|\?)/] } },
})
