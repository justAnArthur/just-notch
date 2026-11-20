/**
 * The page's memory against the mock host, for the memory budget: `bun scripts/memory.ts <url>` with a preview
 * running. After a forced GC at each step it prints the JS heap, DOM nodes and listeners, then repeats the busy
 * steps to show whether anything accumulates.
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5175/'

function headlessShell() {
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(cache)) return undefined
  for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const bin = join(cache, dir, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
    if (existsSync(bin)) return bin
  }
}

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: headlessShell() }))
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 })
const cdp = await page.context().newCDPSession(page)
await cdp.send('Performance.enable')

const mock = (js: string) => page.evaluate(`window.__notchMock.${js}`)
const MB = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

async function sample(label: string) {
  await cdp.send('HeapProfiler.collectGarbage')
  await page.waitForTimeout(200)
  const { metrics } = await cdp.send('Performance.getMetrics')
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
  const strings = await page.evaluate(() => {
    let bytes = 0
    let count = 0
    for (const img of document.images) if (img.currentSrc.startsWith('data:')) (bytes += img.currentSrc.length), count++
    return { bytes, count, attached: document.getElementsByTagName('*').length, portals: document.querySelectorAll('[data-base-ui-portal]').length }
  })
  console.log(
    `${label.padEnd(34)} heap ${MB(m.JSHeapUsedSize!).padStart(9)} / ${MB(m.JSHeapTotalSize!).padStart(9)}  nodes ${String(m.Nodes).padStart(6)}  listeners ${String(m.JSEventListeners).padStart(5)}  data:img ${strings.count} (${MB(strings.bytes)})  attached ${strings.attached}  portals ${strings.portals}`,
  )
  return m
}

async function openTabs() {
  // The hover must change for the island to act on it, and the launcher must have finished closing.
  await mock('hover(false)')
  await page.waitForFunction(() => document.querySelector('#island')?.getAttribute('data-state') !== 'flash', null, { timeout: 15_000 })
  await page.waitForTimeout(500)
  await mock('hover(true)')
  await page.locator('#island [data-island-content]').waitFor()
  for (const tab of await page.$$eval('#island [role=tab]', (t) => t.map((el) => el.getAttribute('aria-label')!))) {
    await page.locator(`#island [role=tab][aria-label="${tab}"]`).click()
    await page.waitForTimeout(350)
  }
  await page.mouse.move(450, 650)
  await mock('hover(false)')
  await page.waitForTimeout(700)
}

async function launcher() {
  await mock('launcher()')
  const search = page.getByPlaceholder(/Search/)
  await search.waitFor()
  for (const q of ['s', 'sa', 'saf', 'term', 'clip', 'files']) {
    await search.fill(q)
    await page.waitForTimeout(150)
  }
  // The first Escape clears the query, the second closes.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await search.waitFor({ state: 'hidden' })
}

await page.goto(url)
await page.locator('#island').waitFor()
await page.waitForTimeout(1500)
const start = await sample('loaded, idle')
await page.waitForTimeout(10_000)
await sample('idle 10 s')
await openTabs()
await sample('every tab opened once')
await launcher()
await sample('launcher searched once')
for (let i = 0; i < 20; i++) {
  await mock('nextTrack()')
  await page.waitForTimeout(60)
}
await sample('20 track changes')
for (let i = 0; i < 10; i++) await openTabs()
await sample('10× every tab')
for (let i = 0; i < 10; i++) await launcher()
const end = await sample('10× launcher')
console.log(`\ngrowth over the run: heap ${MB(end.JSHeapUsedSize! - start.JSHeapUsedSize!)}, nodes ${end.Nodes! - start.Nodes!}`)
await browser.close()
