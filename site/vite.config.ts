import react from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'

// GitHub Pages serves the site under /just-notch/; the workflow passes that base in SITE_BASE.
export default defineConfig({
  base: process.env.SITE_BASE ?? '/',
  plugins: [react(), UnoCSS()],
})
