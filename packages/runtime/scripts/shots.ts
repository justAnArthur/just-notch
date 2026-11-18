/**
 * Screenshots of every tab at both snaps, against the mock host, for a visual review:
 * `bun scripts/shots.ts <url> [shots dir]` with the dev server (or a preview) running.
 * Prints each view's island height and whether its content overflows the first snap.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5174/'
const shots = process.argv[3] ?? join(tmpdir(), 'just-notch-review')
mkdirSync(shots, { recursive: true })

// Reuse an already downloaded headless shell when this Playwright's own revision isn't installed (as e2e.ts does).
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
const errors: string[] = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(e.message))

const settle = () => page.waitForTimeout(900)
const swipe = (dy: number) =>
  page.evaluate(async (dy) => {
    const el = document.querySelector('#island [data-island-content]')!
    for (let i = 0; i < 10; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 16))
    }
    await new Promise((r) => setTimeout(r, 250))
  }, dy)

async function shoot(name: string) {
  await settle()
  const box = (await page.locator('#island > svg').first().boundingBox())!
  const stat = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('#island [data-island-content]')!
    return { overflow: el.scrollHeight - el.clientHeight, island: Math.round(document.querySelector('#island > svg path')!.getBoundingClientRect().height) }
  })
  await page.screenshot({ path: join(shots, `${name}.png`), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, stat.island + 8) } })
  console.log(`${name.padEnd(24)} island ${stat.island}px${stat.overflow > 0 ? `, scrolls ${stat.overflow}px` : ''}`)
}

/** Opens the island if a swipe closed it (a swipe up on the first snap collapses it). */
async function expand() {
  if (await page.locator('#island [data-island-content]').count()) return
  // The hover must change for the island to act on it.
  await page.evaluate(async () => {
    const { hover } = (window as unknown as { __notchMock: { hover(inside: boolean): void } }).__notchMock
    hover(false)
    await new Promise((r) => setTimeout(r, 400))
    hover(true)
  })
  await page.waitForSelector('#island [data-island-content]')
  await page.mouse.move(450, 120)
}

await page.goto(url)
await page.waitForSelector('#island')
await expand()

const tabs = await page.$$eval('#island [role=tab]', (tabs) => tabs.map((t) => t.getAttribute('aria-label')!))
for (const label of tabs) {
  await expand()
  await page.locator(`#island [role=tab][aria-label="${label}"]`).click()
  const name = label.toLowerCase().replace(/\s+/g, '-')
  await shoot(`${name}-fit`)
  await swipe(12)
  await shoot(`${name}-tall`)
  await swipe(-12)
}
await expand()
await page.locator('#island button[aria-label="Settings"]').click()
await shoot('settings')

console.log(`\n${shots}`)
if (errors.length) console.log(`console errors:\n${errors.join('\n')}`)
await browser.close()
