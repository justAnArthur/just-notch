/**
 * Drives the runtime in headless Chromium against the mock host:
 * `bun scripts/e2e.ts <url> [shots dir]`. Serve it with the fixtures listed
 * (`NOTCH_FIXTURES=1`). The first part runs the fixtures alone, the second the
 * default plugins. Fails on any console error.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5175/'
const shots = process.argv[3] ?? '/private/tmp/claude-501/just-notch-shots'
mkdirSync(shots, { recursive: true })
const defaults = readdirSync(join(import.meta.dir, '../../../plugins'))

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
const context = await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 2 })
const errors: string[] = []
function watch(p: Page) {
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  p.on('pageerror', (e) => errors.push(e.stack ?? e.message))
}

function check(ok: unknown, message: string) {
  if (!ok) throw new Error(`e2e: ${message}`)
  console.log(`ok  ${message}`)
}

const state = (p: Page) => p.locator('#island').getAttribute('data-state')
const host = (p: Page, method: string, params: unknown) =>
  p.evaluate(([method, params]) => window.webkit!.messageHandlers.host.postMessage({ plugin: 'runtime', method, params } as never), [method, params] as const)
const enable = (p: Page, id: string, enabled: boolean) => host(p, 'plugins.setEnabled', { id, enabled })
const mock = (p: Page, js: string) => p.evaluate(`window.__notchMock.${js}`)
const regions = (p: Page) => mock(p, 'hitRegions') as Promise<{ rects: { x: number; y: number; w: number; h: number }[]; focusable: boolean }>
const settle = (p: Page) => p.waitForTimeout(700)
async function shoot(p: Page, name: string, full = false) {
  const path = join(shots, `${name}.png`)
  await (full ? p.screenshot({ path }) : p.locator('#island').screenshot({ path }))
  console.log(`    ${path}`)
}
async function waitState(p: Page, expected: string) {
  await p
    .waitForFunction((s) => document.querySelector('#island')?.getAttribute('data-state') === s, expected, { timeout: 4000 })
    .catch(async (error) => {
      throw new Error(`e2e: expected ${expected}, the island is ${await state(p)}`, { cause: error })
    })
}

await context.addInitScript((off: string[]) => {
  if (sessionStorage.getItem('seeded')) return
  sessionStorage.setItem('seeded', '1')
  if (location.pathname.includes('settings')) return
  localStorage.clear()
  for (const id of off) localStorage.setItem(`notch:mock:enabled:${id}`, 'false')
}, [...defaults, 'hello-plugin', 'timer-plugin'])

const page = await context.newPage()
watch(page)
await page.goto(url)
await page.waitForSelector('#island')
check(await page.locator('#island').count(), 'the island element exists')
const shared = await page.evaluate(() => [...document.querySelectorAll('script[type=importmap]')].length)
check(shared === 1, 'one import map')
check(await page.evaluate(() => document.documentElement.classList.contains('dark') && document.documentElement.classList.contains('island')), 'the dark island scope sits on the root')
const origin = (await page.locator('#island').boundingBox())!
const move = (x: number, y: number) => page.mouse.move(origin.x + x, origin.y + y)
const away = () => move(360, 400)

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
let hit = await regions(page)
check(hit.focusable && hit.rects[0].w > 600, `hover expands, focusable, hit region ${hit.rects[0].w}×${hit.rects[0].h}`)
await shoot(page, '4-expanded')

const tabs = () => page.locator('#island [role=tab]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent))
check((await page.getByRole('tab', { name: 'Greeting' }).count()) === 0, "the primary activity's own widget gets no second tab")
await mock(page, 'stopMedia()')
await page.getByRole('tab', { name: 'Greeting' }).click()
await page.waitForSelector('#hello-widget')
await page.getByRole('button', { name: 'Say hi' }).click()
await page.getByRole('button', { name: 'Said hi 1×' }).waitFor()
check(true, 'without its activity the widget tab returns; it renders a modo-ui Button and its useState hook updates')
await shoot(page, '5-expanded-widget')
await mock(page, 'startMedia()')

await away()
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

// ── The default plugins ──

for (const id of defaults) await enable(page, id, true)
await waitState(page, 'compact')
await settle(page)
check(true, `the default plugins run: ${defaults.join(', ')}`)

await mock(page, 'volume()')
await waitState(page, 'flash')
await settle(page)
await move(350, 60)
await move(360, 60)
await page.waitForTimeout(2200)
check((await state(page)) === 'flash', 'hovering a flash holds it past its duration and does not expand')
const track = (await page.locator('#island .cursor-ew-resize').first().boundingBox())!
const volume = () => page.locator('#island input[type=range]').getAttribute('aria-valuenow')
const before = await volume()
await page.mouse.move(track.x + track.width * 0.1, track.y + track.height / 2)
await page.mouse.down()
for (let i = 1; i <= 8; i++) await page.mouse.move(track.x + track.width * (0.1 + i * 0.1), track.y + track.height / 2)
await page.mouse.up()
await page.waitForTimeout(300)
check((await state(page)) === 'flash' && (await volume()) !== before, `the HUD slider drags (${before} → ${await volume()}) without expanding`)
await away()
await waitState(page, 'compact')
check(true, 'leaving the flash resumes its timer')
await mock(page, 'volume()')
await waitState(page, 'flash')
await settle(page)
const glyph = (await page.locator('#island svg.lucide').first().boundingBox())!
await page.mouse.click(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2)
await waitState(page, 'expanded')
check(true, 'a click on the flash expands it')
await settle(page)

const names = (await tabs()).map((n) => n?.replace(/^(.+)\1$/, '$1'))
const strip = await page.evaluate(() => {
  const viewport = document.querySelector('#island [data-slot=scroll-area-viewport]') as HTMLElement
  const wing = viewport.closest('[data-slot=scroll-area]')!.parentElement!.getBoundingClientRect()
  const v = viewport.getBoundingClientRect()
  return { inside: v.left >= wing.left && v.right <= wing.right, scrolls: viewport.scrollWidth > viewport.clientWidth }
})
check(new Set(names).size === names.length && names.length === 7 && strip.inside, `one tab per plugin beside the notch, no duplicates: ${names.join(', ')}`)
await page.locator('#island [role=tab]').last().click()
await settle(page)
const last = await page.evaluate(() => {
  const viewport = document.querySelector('#island [data-slot=scroll-area-viewport]')!.getBoundingClientRect()
  const tab = document.querySelector('#island [role=tab][aria-selected=true]')!.getBoundingClientRect()
  return tab.left >= viewport.left - 1 && tab.right <= viewport.right + 1
})
check(last, `the strip ${strip.scrolls ? 'scrolls the selected tab into view' : 'fits every tab'}`)
await shoot(page, '8-tabs')

await away()
await mock(page, 'hover(false)')
await waitState(page, 'compact')
await mock(page, 'fileDrag()')
await waitState(page, 'flash')
await waitState(page, 'compact')
await mock(page, 'hover(true)')
await waitState(page, 'expanded')
await page.getByRole('tab', { name: 'Shelf' }).click()
await page.locator('[title="/Users/me/Desktop/notch.png"]').click({ button: 'right' })
await page.getByRole('menu').waitFor()
await settle(page)
const menu = await page.evaluate(() => {
  const r = document.querySelector('[data-base-ui-portal] > [data-side]')!.getBoundingClientRect()
  const o = document.querySelector('#island')!.getBoundingClientRect()
  return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height, scheme: getComputedStyle(document.querySelector('[role=menu]')!).colorScheme }
})
hit = await regions(page)
const covered = hit.rects.some((r) => r.x <= menu.x + 0.5 && r.y <= menu.y + 0.5 && r.x + r.w >= menu.x + menu.w - 0.5 && r.y + r.h >= menu.y + menu.h - 0.5)
check(menu.scheme === 'dark' && covered, `the shelf menu is dark and in the hit regions (${Math.round(menu.y)}…${Math.round(menu.y + menu.h)})`)
await shoot(page, '9-shelf-menu', true)
await page.getByRole('menuitem', { name: 'Remove from shelf' }).click()
await page.waitForTimeout(400)
check((await page.locator('[title="/Users/me/Desktop/notch.png"]').count()) === 0 && (await regions(page)).rects.length === 1, 'the menu item works and its rect leaves the hit regions')
await page.getByRole('button', { name: 'Clear' }).click()

await away()
await mock(page, 'hover(false)')
await mock(page, 'stopMedia()')
await waitState(page, 'idle')
const settings = await context.newPage()
watch(settings)
await settings.setViewportSize({ width: 760, height: 520 })
await settings.goto(new URL('settings.html', url).href)
await settings.getByRole('heading', { name: 'General' }).waitFor()
check(((await settings.locator('[data-slot=sidebar]').first().boundingBox())?.width ?? 0) > 150, 'the settings sidebar stays at 760×520')
await settings.screenshot({ path: join(shots, '10-settings.png') })
await settings.getByRole('button', { name: 'System' }).click()
await settings.getByRole('switch', { name: /CPU load/ }).click()
await waitState(page, 'compact')
check(true, 'a switch flipped in the settings page reaches the island page through storage.changed')
await settings.getByRole('switch', { name: /CPU load/ }).click()
await waitState(page, 'idle')
await settings.close()

await page.reload()
await page.waitForSelector('#island')
await settle(page)
await page.screenshot({ path: join(shots, '0-page.png') })

check(errors.length === 0, `no console errors${errors.length ? `:\n${errors.join('\n')}` : ''}`)
await browser.close()
