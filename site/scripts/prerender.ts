/**
 * After `vite build` and the SSR build of src/entry-server.tsx (into .ssr/), writes each page's HTML into its
 * dist/…/index.html, so the headline paints with the document instead of after the JavaScript. The client
 * hydrates it (src/boot.tsx).
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { PageName } from '../src/entry-server'

const site = resolve(import.meta.dirname, '..')
const ssr = join(site, '.ssr')
const { render } = (await import(join(ssr, 'entry-server.js'))) as typeof import('../src/entry-server')

const PAGES: [PageName, string][] = [
  ['home', 'index.html'],
  ['changelog', 'changelog/index.html'],
  ['developers', 'developers/index.html'],
]

for (const [name, file] of PAGES) {
  const path = join(site, 'dist', file)
  const html = readFileSync(path, 'utf8')
  const root = '<div id="root"></div>'
  if (!html.includes(root)) throw new Error(`${file}: no empty #root to fill`)
  writeFileSync(path, html.replace(root, `<div id="root">${render(name)}</div>`))
  console.log(`prerendered ${file}`)
}

rmSync(ssr, { recursive: true, force: true })
