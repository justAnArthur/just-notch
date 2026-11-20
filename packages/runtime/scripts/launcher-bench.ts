/**
 * Launcher timings and stability against the mock host: `bun scripts/launcher-bench.ts <url> [shots dir]`
 * with the dev server (or a preview) running.
 *
 * For each query it types one key at a time and reports:
 * - keystroke → stable results: the last change to the results after each key, typed 500 ms apart;
 * - section unmounts between keystrokes, typed 120 ms apart: a section unmounted though it shows both before the
 *   key and when the next one comes;
 * - the rows each query ends with, and a screenshot of them.
 * Then it checks that an arrowed-to row stays selected while late rows arrive, and times ↩ → hidden and ↩ → action
 * (the `launcher.run` mark).
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5174/'
const shots = process.argv[3] ?? join(tmpdir(), 'just-notch-launcher')
mkdirSync(shots, { recursive: true })

function headlessShell() {
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(cache)) return undefined
  for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const bin = join(cache, dir, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
    if (existsSync(bin)) return bin
  }
}

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: headlessShell() }))
const page = await browser.newPage({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 2 })
const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(url)
await page.waitForSelector('#island')

const field = page.locator('input[aria-label="Search"]')

async function openLauncher() {
  await page.evaluate(() => (window as unknown as { __notchMock: { launcher(): void } }).__notchMock.launcher())
  await field.waitFor()
  await page.waitForTimeout(1200)
}

async function closeLauncher() {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await field.waitFor({ state: 'detached' })
  await page.waitForTimeout(300)
}

/** Watches the results: the time of each change, and every section removed or added. */
const watch = () =>
  page.evaluate(() => {
    const w = window as unknown as { __bench: { changes: number[]; removed: string[]; added: string[] } }
    w.__bench = { changes: [], removed: [], added: [] }
    const groups = (nodes: NodeList) =>
      [...nodes].flatMap((n) => (n instanceof HTMLElement ? [n, ...n.querySelectorAll<HTMLElement>('[role=group]')] : [])).filter((n) => n.getAttribute('role') === 'group')
    new MutationObserver((records) => {
      const inResults = records.some((r) => (r.target as HTMLElement).closest?.('[role=listbox]') || [...r.addedNodes, ...r.removedNodes].some((n) => n instanceof HTMLElement && (n.matches('[role=listbox], [role=group]') || n.querySelector('[role=listbox]'))))
      if (inResults) w.__bench.changes.push(performance.now())
      for (const r of records) {
        // A section React only moved (sections reorder by their best row) is back in the page by now: not an unmount.
        for (const g of groups(r.removedNodes)) if (!g.isConnected) w.__bench.removed.push(g.getAttribute('aria-label')!)
        for (const g of groups(r.addedNodes)) w.__bench.added.push(g.getAttribute('aria-label')!)
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  })

const bench = () => page.evaluate(() => (window as unknown as { __bench: { changes: number[]; removed: string[]; added: string[] } }).__bench)
const now = () => page.evaluate(() => performance.now())

const rowsNow = () =>
  page.$$eval('[role=listbox] [role=group]', (groups) =>
    groups.map((g) => `${g.getAttribute('aria-label')}: ${[...g.querySelectorAll('[role=option]')].map((o) => o.querySelector('span span')?.textContent ?? o.textContent).join(' | ')}`),
  )

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

const titles = () => page.$$eval('[role=listbox] [role=group]', (groups) => groups.map((g) => g.getAttribute('aria-label')!))

/**
 * Types `query` a key every `gap` ms. Per key: when the results last changed, and which sections were unmounted
 * though they show both before the key and when the next one comes (a blink, not a change in what matches).
 */
async function typeQuery(query: string, gap: number) {
  await watch()
  const stable: number[] = []
  const blinks: string[] = []
  for (const key of query) {
    const before = await titles()
    const at = await now()
    const seen = (await bench()).removed.length
    await page.keyboard.type(key)
    await page.waitForTimeout(gap)
    const { changes, removed } = await bench()
    const after = await titles()
    const last = changes.filter((t) => t >= at).at(-1)
    stable.push(last ? Math.round(last - at) : 0)
    blinks.push(...removed.slice(seen).filter((title) => before.includes(title) && after.includes(title)).map((title) => `${key}:${title}`))
  }
  return { stable, blinks }
}

const report: string[] = []

/**
 * The open, timed in the page from the shortcut: when the field is readable (its opacity, with every ancestor's,
 * past 0.9, and the bar under 90 % of it) and, with keys typed at once, when results show and whether any scope button showed (the split).
 */
async function timeOpen(typed: string) {
  const t = await page.evaluate(async (typed) => {
    const w = window as unknown as { __notchMock: { launcher(): void } }
    const opacity = (el: Element | null) => {
      let o = 1
      for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity)
      return o
    }
    const start = performance.now()
    w.__notchMock.launcher()
    const times: { field?: number; results?: number; split: boolean } = { split: false }
    if (typed) {
      await new Promise((r) => setTimeout(r, 30))
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Search"]')!
      // React's own value setter, so its onChange sees the change.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, typed)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    while (performance.now() - start < 1200) {
      await new Promise((r) => requestAnimationFrame(r))
      const now = performance.now() - start
      const field = document.querySelector('input[aria-label="Search"]')
      // Readable: opaque, and the bar spread under (most of) it, since the field is clipped to the bar's black.
      const label = field?.closest('label')
      const bar = label?.parentElement?.querySelector('svg rect')
      const spread = label && bar ? bar.getBoundingClientRect().width / label.getBoundingClientRect().width : 0
      if (times.field === undefined && field && opacity(field) > 0.9 && spread > 0.9) times.field = Math.round(now)
      const list = document.querySelector('[role=listbox]')
      if (times.results === undefined && list && opacity(list) > 0.5) times.results = Math.round(now)
      if (typed && [...document.querySelectorAll('button[aria-pressed]')].some((b) => opacity(b) > 0.2)) times.split = true
    }
    return times
  }, typed)
  await closeLauncher()
  return t
}
const runs = [1, 2, 3]
const fields: number[] = []
for (const _ of runs) fields.push((await timeOpen('')).field ?? NaN)
const typedRuns: { field?: number; results?: number; split: boolean }[] = []
for (const _ of runs) typedRuns.push(await timeOpen('saf'))
report.push(
  `open: shortcut → field readable ${fields.join('/')} ms; typing "saf" at once: results ${typedRuns.map((r) => r.results).join('/')} ms, scope buttons split off: ${typedRuns.some((r) => r.split) ? 'yes' : 'no'}`,
)

// The empty bar, for its placeholder.
await openLauncher()
const bar = (await field.boundingBox())!
await page.screenshot({ path: join(shots, 'bar.png'), clip: { x: bar.x - 60, y: bar.y - 24, width: 820, height: bar.height + 48 } })
await closeLauncher()
for (const query of ['readme', 'term', 'rea', 'sett']) {
  // A quick typist, for blinks; then one key at a time with time to settle, for how long results take.
  await openLauncher()
  const { blinks } = await typeQuery(query, 120)
  await closeLauncher()
  await openLauncher()
  const { stable } = await typeQuery(query, 500)
  const sheet = page.locator('[role=listbox]').first()
  const box = (await sheet.boundingBox()) ?? undefined
  if (box) await page.screenshot({ path: join(shots, `q-${query}.png`), clip: { x: box.x - 8, y: box.y - 76, width: box.width + 16, height: Math.min(box.height + 84, 600) } })
  report.push(
    `"${query}": keystroke → stable results median ${median(stable)} ms, worst ${Math.max(...stable)} ms (per key ${stable.join('/')}); section unmounts between keystrokes ${blinks.length}${blinks.length ? ` (${blinks.join(', ')})` : ''}`,
    ...(await rowsNow()).map((line) => `    ${line}`),
  )
  await closeLauncher()
}

// An arrowed-to row keeps its selection when late rows (files) land above it.
await openLauncher()
await page.keyboard.type('rea')
await page.waitForTimeout(30)
const options = await page.locator('[role=option]').count()
await page.keyboard.press('ArrowUp') // wraps to the last row: the web search
const picked = await page.locator('[role=option][aria-selected=true]').textContent()
await page.waitForTimeout(500)
const still = await page.locator('[role=option][aria-selected=true]').textContent()
report.push(`selection: picked "${picked}" of ${options} rows; after late rows "${still}" → ${picked === still ? 'kept' : 'JUMPED'}`)

// ↩ → hidden: until the launcher is gone from the page, and until its action runs (a performance mark, when present).
await page.keyboard.press('ArrowDown')
await page.evaluate(() => {
  const w = window as unknown as { __hidden?: number; __enter?: number }
  window.addEventListener('keydown', () => (w.__enter = performance.now()), { capture: true, once: true })
  const field = document.querySelector('input[aria-label="Search"]')!
  const tick = () => {
    // The bar's black (the SVG beside the field) fades with the launcher's root, after the field and the sheet.
    const svg = field.closest('label')?.parentElement?.querySelector('svg')
    let opacity = 1
    for (let el: Element | null | undefined = svg; el; el = el.parentElement) opacity *= Number(getComputedStyle(el).opacity)
    const faded = !field.isConnected || opacity < 0.02
    if (faded) w.__hidden = performance.now()
    else requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
await page.keyboard.press('Enter')
await page.waitForFunction(() => (window as unknown as { __hidden?: number }).__hidden !== undefined)
const { enterAt, hiddenAt } = await page.evaluate(() => {
  const w = window as unknown as { __hidden: number; __enter: number }
  return { enterAt: w.__enter, hiddenAt: w.__hidden }
})
const ranAt = await page.evaluate(() => performance.getEntriesByName('launcher.run').at(-1)?.startTime)
report.push(`close: ↩ → hidden ${Math.round(hiddenAt - enterAt)} ms; ↩ → action ${ranAt ? `${Math.round(ranAt - enterAt)} ms` : 'not marked'}`)

console.log(report.join('\n'))
if (errors.length) console.log(`page errors:\n${errors.join('\n')}`)
await browser.close()
