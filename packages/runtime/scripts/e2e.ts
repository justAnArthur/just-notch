/**
 * Drives the runtime in headless Chromium against the mock host:
 * `bun scripts/e2e.ts <url> [shots dir]`. Serve it with the fixtures listed
 * (`NOTCH_FIXTURES=1`). Fails on any console error.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5175/'
const shots = process.argv[3] ?? '/private/tmp/claude-501/just-notch-shots'
mkdirSync(shots, { recursive: true })

// Reuse an already downloaded headless shell when this Playwright's own revision isn't installed.
function headlessShell() {
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(cache)) return undefined
  for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const bin = join(cache, dir, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
    if (existsSync(bin)) return bin
  }
}

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: headlessShell() }))
const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 2 })
const errors: string[] = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(e.stack ?? e.message))

function check(ok: unknown, message: string) {
  if (!ok) throw new Error(`e2e: ${message}`)
  console.log(`ok  ${message}`)
}

const state = (p: Page) => p.locator('#island').getAttribute('data-state')
const host = (p: Page, method: string, params: unknown) =>
  p.evaluate(([method, params]) => window.webkit!.messageHandlers.host.postMessage({ plugin: 'runtime', method, params } as never), [method, params] as const)
const enable = (p: Page, id: string, enabled: boolean) => host(p, 'plugins.setEnabled', { id, enabled })
const mock = (p: Page, js: string) => p.evaluate(`window.__notchMock.${js}`)
const settle = (p: Page) => p.waitForTimeout(700)
async function shoot(p: Page, name: string) {
  await p.locator('#island').screenshot({ path: join(shots, `${name}.png`), omitBackground: false })
  console.log(`    ${join(shots, `${name}.png`)}`)
}
async function waitState(p: Page, expected: string) {
  await p.waitForFunction((s) => document.querySelector('#island')?.getAttribute('data-state') === s, expected, { timeout: 4000 })
}

await page.addInitScript(() => {
  if (sessionStorage.getItem('seeded')) return
  sessionStorage.setItem('seeded', '1')
  localStorage.clear()
  localStorage.setItem('notch:mock:enabled:hello-plugin', 'false')
  localStorage.setItem('notch:mock:enabled:timer-plugin', 'false')
})
await page.goto(url)
await page.waitForSelector('#island')
check(await page.locator('#island').count(), 'the island element exists')
const shared = await page.evaluate(() => [...document.querySelectorAll('script[type=importmap]')].length)
check(shared === 1, 'one import map')

await settle(page)
check((await state(page)) === 'idle', 'idle with nothing active')
await shoot(page, '1-idle')

await enable(page, 'hello-plugin', true)
await waitState(page, 'compact')
await settle(page)
check(true, 'the fixture plugin shows media: compact')
await shoot(page, '2-compact')

await enable(page, 'timer-plugin', true)
await waitState(page, 'split')
await settle(page)
check(true, 'a second activity with a minimal view: split')
await shoot(page, '3-split')

await mock(page, 'hover(true)')
await waitState(page, 'expanded')
await settle(page)
const regions = (await mock(page, 'hitRegions')) as { rects: { w: number; h: number }[]; focusable: boolean }
check(regions.focusable && regions.rects[0].w > 600, `hover expands, focusable, hit region ${regions.rects[0].w}×${regions.rects[0].h}`)
await shoot(page, '4-expanded')

await page.getByRole('tab', { name: 'Greeting' }).click()
await page.waitForSelector('#hello-widget')
await page.getByRole('button', { name: 'Say hi' }).click()
await page.getByRole('button', { name: 'Said hi 1×' }).waitFor()
check(true, 'the widget renders a modo-ui Button and its useState hook updates')
await shoot(page, '5-expanded-widget')

await page.mouse.move(5, 540)
await mock(page, 'hover(false)')
await waitState(page, 'split')
check(true, 'hover out collapses')

await mock(page, 'volume()')
await waitState(page, 'flash')
await page.waitForTimeout(250)
await mock(page, 'volume()')
await settle(page)
await shoot(page, '6-flash-volume')
await waitState(page, 'split')
check(true, 'the volume HUD flashes and auto-dismisses')

await mock(page, 'charger()')
await waitState(page, 'flash')
await settle(page)
await shoot(page, '7-flash-charging')

await page.keyboard.press('Escape')
await enable(page, 'timer-plugin', false)
await enable(page, 'hello-plugin', false)
await waitState(page, 'idle')
check(true, 'disabling plugins removes their activities')

await page.reload()
await page.waitForSelector('#island')
await settle(page)
await page.screenshot({ path: join(shots, '0-page.png') })

check(errors.length === 0, `no console errors${errors.length ? `:\n${errors.join('\n')}` : ''}`)
await browser.close()
