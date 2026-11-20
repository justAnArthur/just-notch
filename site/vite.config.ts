import react from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const page = (path: string) => resolve(import.meta.dirname, path)

// Inter's Latin face is requested only once the stylesheet is parsed; preloading it saves that hop for
// the headline, the page's largest paint.
const preloadInter: Plugin = {
  name: 'preload-inter',
  transformIndexHtml: {
    order: 'post',
    handler(html, { bundle }) {
      const font = Object.keys(bundle ?? {}).find((file) => /inter-latin-opsz-normal-[\w-]+\.woff2$/.test(file))
      if (!font) return html
      const base = process.env.SITE_BASE ?? '/'
      return html.replace('</head>', `  <link rel="preload" href="${base}${font}" as="font" type="font/woff2" crossorigin />\n  </head>`)
    },
  },
}

// The pages are prerendered (scripts/prerender.ts), so the JavaScript only adds the live island and the
// controls: it loads on the first interaction or shortly after load, never competing with the first paint.
const deferEntry: Plugin = {
  name: 'defer-entry',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html) {
      const entry = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/)
      if (!entry) return html
      // On the visitor's first move, key or scroll, or 1.5 s after load, whichever comes first.
      const loader = `<script>(function(){var done=false,events=['pointermove','pointerdown','keydown','scroll','touchstart'];function go(){if(done)return;done=true;events.forEach(function(e){removeEventListener(e,go)});var s=document.createElement('script');s.type='module';s.src='${entry[1]}';document.head.appendChild(s)}events.forEach(function(e){addEventListener(e,go,{passive:true,once:true})});addEventListener('load',function(){setTimeout(go,1500)})})()</script>`
      return html.replace(entry[0], loader).replace(/\s*<link rel="modulepreload"[^>]*>/g, '')
    },
  },
}

// GitHub Pages serves the site under /just-notch/; the workflow passes that base in SITE_BASE.
export default defineConfig({
  base: process.env.SITE_BASE ?? '/',
  plugins: [react(), UnoCSS(), preloadInter, deferEntry],
  // The prerender bundles modo-ui and the kit, so their CSS imports go through Vite, not Node.
  ssr: { noExternal: [/^@justanarthur\//] },
  build: {
    rollupOptions: {
      input: { home: page('index.html'), changelog: page('changelog/index.html'), developers: page('developers/index.html') },
    },
  },
})
