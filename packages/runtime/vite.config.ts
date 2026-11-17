import { resolve } from 'node:path'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import notchRuntime from './bundler/vite-plugin.ts'

export default defineConfig({
  plugins: [notchRuntime(), UnoCSS()],
  build: {
    target: 'safari17',
    rolldownOptions: {
      input: { index: resolve(import.meta.dirname, 'index.html') },
    },
  },
})
