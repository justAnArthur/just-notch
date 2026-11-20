/**
 * Drives the runtime in headless Chromium against the mock host:
 * `bun scripts/e2e.ts <url> [shots dir]`. Serve it with the fixtures listed
 * (`NOTCH_FIXTURES=1`). The first part runs the fixtures alone, the second the
 * default plugins. Fails on any console error.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5175/'
const shots = process.argv[3] ?? join(tmpdir(), 'just-notch-shots')
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
/** A two-finger swipe: `n` wheel events at `selector`, then a quiet gap that ends the gesture. Chromium's deltas are the finger's (no natural scrolling). */
const swipe = (p: Page, selector: string, dx: number, dy: number, n = 10) =>
  p.evaluate(
    async ([selector, dx, dy, n]) => {
      const el = document.querySelector(selector)!
      for (let i = 0; i < n; i++) {
        el.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, bubbles: true, cancelable: true }))
        await new Promise((r) => setTimeout(r, 16))
      }
      await new Promise((r) => setTimeout(r, 250))
    },
    [selector, dx, dy, n] as const,
  )
const primary = (p: Page) => p.locator('#island').getAttribute('data-primary')
const selectedTab = (p: Page) => p.locator('#island [role=tab][aria-selected=true]').getAttribute('aria-label')
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
}, [...defaults, 'hello-plugin', 'timer-plugin', 'github', 'youtrack'])

const page = await context.newPage()
watch(page)
await page.goto(url)
await page.waitForSelector('#island')
check(await page.locator('#island').count(), 'the island element exists')
const shared = await page.evaluate(() => [...document.querySelectorAll('script[type=importmap]')].length)
check(shared === 1, 'one import map')
check(await page.evaluate(() => document.documentElement.classList.contains('dark') && document.documentElement.classList.contains('island')), 'the dark island scope sits on the root')
const platform = await page.evaluate(`(async () => {
  const host = window.__notchHost
  await host.store.set('e2e', { ok: true })
  return { kind: host.kind, stored: await host.store.get('e2e'), scheme: await host.os.colorScheme() }
})()`)
check(JSON.stringify(platform) === JSON.stringify({ kind: 'swift', stored: { ok: true }, scheme: 'dark' }), 'the platform Host runs over the mock bridge')
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

await swipe(page, '#island svg path', 10, 0)
await settle(page)
check((await state(page)) === 'split' && (await primary(page)) === 'timer-plugin', 'a sideways swipe over the split island swaps primary and bubble')
await shoot(page, '3b-split-swapped')
await swipe(page, '#island svg path', -10, 0)
await settle(page)
check((await primary(page)) === 'hello-plugin', 'another swipe swaps them back')

await mock(page, 'hover(true)')
await waitState(page, 'expanded')
await settle(page)
let hit = await regions(page)
check(hit.focusable && hit.rects[0].w > 600, `hover expands, focusable, hit region ${hit.rects[0].w}×${hit.rects[0].h}`)
await shoot(page, '4-expanded')

const tabs = () => page.locator('#island [role=tab]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent))
check(
  (await page.getByRole('tab', { name: 'Greeting' }).count()) === 1 && (await selectedTab(page)) === 'Greeting',
  "the primary activity's plugin keeps its one tab, selected on open",
)
await page.waitForSelector('#hello-widget')
check(true, 'during its activity the tab shows the widget, not a view of its own')
await mock(page, 'stopMedia()')
await page.getByRole('tab', { name: 'Greeting' }).click()
await page.waitForSelector('#hello-widget')
await page.getByRole('button', { name: 'Say hi' }).click()
await page.getByRole('button', { name: 'Said hi 1×' }).waitFor()
check(true, 'without its activity the widget tab stays; it renders a modo-ui Button and its useState hook updates')
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

// The real host answers some subscriptions with `null` before its first sample; the System widget must never see it.
await mock(page, "nullSnapshot('stats')")
for (const id of defaults) await enable(page, id, true)
await waitState(page, 'compact')
await settle(page)
check(true, `the default plugins run: ${defaults.join(', ')}`)

// Now Playing announces a new track with the kit's flash.
await mock(page, 'nextTrack()')
await waitState(page, 'flash')
await settle(page)
await shoot(page, '6-flash-track')
await move(350, 60)
await move(360, 60)
await page.waitForTimeout(3000)
check((await state(page)) === 'flash', 'hovering a flash holds it past its duration and does not expand')
await away()
await waitState(page, 'compact')
check(true, 'leaving the flash resumes its timer')
await mock(page, 'nextTrack()')
await waitState(page, 'flash')
await settle(page)
await move(360, 50)
await page.mouse.down()
await page.mouse.up()
await waitState(page, 'expanded')
check(true, 'a click on the flash expands it')
await settle(page)

const names = (await tabs()).map((n) => n?.replace(/^(.+)\1$/, '$1'))
const spread = await page.evaluate(() => {
  const island = document.querySelector('#island')!.getBoundingClientRect()
  const strip = document.querySelector('#island [data-tab-strip]') as HTMLElement
  // The mock's notch: 185 wide, centered in the 720 panel.
  const notch = { left: island.left + 267.5, right: island.left + 452.5 }
  const rects = [...document.querySelectorAll('#island [role=tab]')].map((t) => t.getBoundingClientRect())
  return {
    scrolls: strip.scrollWidth > strip.clientWidth,
    clear: rects.every((r) => r.left >= island.left + 19 && r.right <= island.right - 19 && (r.right <= notch.left || r.left >= notch.right)),
    wings: [rects.filter((r) => r.right <= notch.left).length, rects.filter((r) => r.left >= notch.right).length],
  }
})
check(
  new Set(names).size === names.length && names.length === 7 && !spread.scrolls && spread.clear && spread.wings[0] > 0 && spread.wings[1] > 0,
  `every tab in view at a glance, ${spread.wings[0]} left and ${spread.wings[1]} right of the notch, none under it: ${names.join(', ')}`,
)
await page.locator('#island [role=tab]').last().click()
await settle(page)
check((await selectedTab(page)) === names.at(-1), 'the last tab is a click away')
await shoot(page, '8-tabs')
await page.keyboard.press('ArrowLeft')
check((await selectedTab(page)) === names.at(-2), 'ArrowLeft moves to the previous tab')
await page.keyboard.press('ArrowRight')
check((await selectedTab(page)) === names.at(-1), 'ArrowRight moves to the next tab')

await swipe(page, '#island [data-island-content]', 12, 0)
check((await selectedTab(page)) === names.at(-2), 'a swipe to the right goes back one tab (one per gesture)')
await swipe(page, '#island [data-island-content]', -12, 0)
check((await selectedTab(page)) === names.at(-1), 'a swipe to the left goes forward one tab')
const settingsOpen = async () => (await page.locator('#island button[aria-label="Settings"]').getAttribute('aria-pressed')) === 'true'
const middle = (await page.locator('#island [data-island-content]').boundingBox())!
await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2)
await swipe(page, '#island [data-island-content]', -12, 0)
await settle(page)
const opened = { settings: await settingsOpen(), h: Math.round((await page.locator('#island > svg path').first().boundingBox())!.height) }
check(opened.settings && opened.h > 500, `past the last widget a swipe opens settings, on the tall snap (${opened.h}px)`)
await swipe(page, '#island [data-island-content]', -12, 0)
await settle(page)
check((await selectedTab(page)) === names[0], 'past settings a swipe wraps round to the first tab')
await page.keyboard.press('ArrowLeft')
await page.keyboard.press('ArrowLeft')
check((await selectedTab(page)) === names.at(-1), 'and back the other way, round through settings')

await page.getByRole('tab', { name: 'System' }).click()
await page.locator('#island [data-island-content]').getByText(/%/).first().waitFor({ timeout: 4000 })
check(true, 'the System widget waits out a null snapshot and renders its first sample')

// A view taller than the first snap: a swipe down takes the island to the tall snap instead of scrolling it.
await page.evaluate(() => {
  const filler = document.createElement('div')
  filler.style.height = '600px'
  document.querySelector('#island [data-island-content]')!.append(filler)
})
const content = page.locator('#island [data-island-content]')
await swipe(page, '#island [data-island-content]', 0, 12)
await settle(page)
check(
  (await content.evaluate((el) => el.scrollTop)) === 0 && (await page.locator('#island > svg path').first().boundingBox())!.height > 500,
  'on the first snap a swipe down over a long view pulls the island to the tall snap, without scrolling',
)

// On the tall snap a view taller than the content area scrolls; the wheel stays with it, it never collapses the island.
const scrollTop = () => content.evaluate((el) => el.scrollTop)
const box = (await content.boundingBox())!
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 40)
await page.waitForTimeout(300)
const down = await scrollTop()
for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -40)
await page.waitForTimeout(300)
check(down > 100 && (await scrollTop()) < down && (await state(page)) === 'expanded', `the content scrolls both ways (${down}px → ${await scrollTop()}px) and the island stays open`)
check((await content.getAttribute('data-fade')) === 'start end', 'mid-scroll both content edges fade')
await shoot(page, '8c-content-scroll')
await content.evaluate((el) => el.scrollTo({ top: 0 }))
// Up to the first snap and then closed; the pointer stays near the top, inside the shorter island.
await page.mouse.move(box.x + box.width / 2, box.y + 10)
await swipe(page, '#island [data-island-content]', 0, -12)
await settle(page)
check((await state(page)) === 'expanded', 'a swipe up from the tall snap returns to the first snap')
await swipe(page, '#island [data-island-content]', 0, -12)
await page.waitForTimeout(300)
check((await state(page)) === 'compact', 'at the top a swipe up collapses the island')
await swipe(page, '#island svg path', 0, 12)
await waitState(page, 'expanded')
check(true, 'a swipe down expands it')
await settle(page)
const insets = await page.evaluate(() => {
  const island = document.querySelector('#island svg path')!.getBoundingClientRect()
  const content = document.querySelector('#island [data-island-content] > div')!.getBoundingClientRect()
  return { bottom: Math.round(island.bottom - content.bottom) }
})
check(insets.bottom === 20, `the first snap fits the content: 20px at the bottom as at the sides (${insets.bottom}px)`)
const fitted = (await page.locator('#island > svg path').first().boundingBox())!.height
await swipe(page, '#island [data-island-content]', 0, 12)
await settle(page)
const tall = (await page.locator('#island > svg path').first().boundingBox())!.height
check(tall > fitted + 100, `another swipe down pulls it to the tall snap (${Math.round(fitted)} → ${Math.round(tall)}px)`)
await swipe(page, '#island [data-island-content]', 0, -12)
await settle(page)
check((await page.locator('#island > svg path').first().boundingBox())!.height < tall - 100 && (await state(page)) === 'expanded', 'a swipe up returns to the first snap')
const haptics = (await mock(page, 'haptics')) as string[]
check(haptics.includes('generic') && haptics.includes('alignment'), `committed swipes tap the trackpad (${[...new Set(haptics)].join(', ')})`)

await mock(page, 'resize(460)')
await settle(page)
const strip = page.locator('#island [data-tab-strip]')
const overflow = await strip.evaluate((el) => ({ scrolls: el.scrollWidth > el.clientWidth, left: el.scrollLeft, fade: el.getAttribute('data-fade') }))
check(overflow.scrolls && overflow.left === 0 && overflow.fade === 'end', 'on a narrower screen the strip overflows and fades its far edge')
await swipe(page, '#island [data-tab-strip]', 0, 30, 20)
const scrolled = await strip.evaluate((el) => {
  const view = el.getBoundingClientRect()
  const last = el.querySelector('[role=tab]:last-child')!.getBoundingClientRect()
  return { left: el.scrollLeft, end: last.right <= view.right + 0.5 }
})
check(scrolled.left > 0 && scrolled.end && (await state(page)) === 'expanded', `a vertical wheel over it scrolls it sideways to the last tab (${scrolled.left}px)`)
await shoot(page, '8b-tabs-overflow')
await mock(page, 'resize()')
await settle(page)

await away()
await mock(page, 'hover(false)')
await waitState(page, 'compact')
await mock(page, 'hover(true)')
await waitState(page, 'expanded')
for (const [tab, text] of [
  ['Calendar', 'Design standup'],
  ['Weather', 'Bratislava'],
  ['Clock', 'Start focus'],
  ['Clipboard', 'justanarthur.github.io'],
  ['Recent files', 'invoice-2026-11.pdf'],
]) {
  await page.getByRole('tab', { name: tab }).click()
  await page.locator('#island [data-island-content]').getByText(text).first().waitFor({ timeout: 4000 })
  check(true, `the ${tab} widget renders the kit block on the host's data`)
}
await settle(page)
await shoot(page, '9-recent-files')

await away()
await mock(page, 'hover(false)')
await mock(page, 'stopMedia()')
await waitState(page, 'idle')
// Plugin pages are reached through Settings › Plugins (one path since kit 0.6); System starts off.
const openSystemSettings = async () => {
  await enable(page, 'system', true)
  // Settings reopens on the page it was left on.
  if (await page.locator('#island').getByRole('switch', { name: /CPU load/ }).isVisible()) return
  await page.locator('#island').getByRole('button', { name: 'Plugins', exact: true }).first().click()
  await page.locator('#island').getByRole('button', { name: /^System/ }).first().click()
}
// Settings is a page of the island, on its tall snap.
await host(page, 'window.openSettings', {})
await waitState(page, 'expanded')
await page.locator('#island').getByText('Launch at login').waitFor({ timeout: 4000 })
await settle(page)
const sheet = (await page.locator('#island > svg path').first().boundingBox())!
check(sheet.height > 500, `settings opens in the island on the tall snap (${Math.round(sheet.height)}px)`)
await shoot(page, '10-settings')
await openSystemSettings()
await page.locator('#island').getByRole('switch', { name: /CPU load/ }).click()
await page.keyboard.press('Escape')
await away()
await mock(page, 'hover(false)')
await waitState(page, 'compact')
check(true, "a plugin's switch in settings takes effect: the System wings show")
await host(page, 'window.openSettings', {})
await waitState(page, 'expanded')
await openSystemSettings()
await page.locator('#island').getByRole('switch', { name: /CPU load/ }).click()
await page.keyboard.press('Escape')

await page.reload()
await page.waitForSelector('#island')
await settle(page)
await page.screenshot({ path: join(shots, '0-page.png') })

// --- WS-A: island shell
{
  check((await page.locator('#island [data-island-title]').count()) === 0, 'no title row above the tabs')

  // Activities start and end under an open island; the icons never move.
  await mock(page, 'hover(true)')
  await waitState(page, 'expanded')
  const order = await tabs()
  const changes = ['startMedia()', 'eventSoon(5)', 'stopMedia()', 'download()', 'startMedia()', 'nextTrack()', 'stopMedia()', 'eventSoon(3)', 'startMedia()', 'stopMedia()']
  for (const change of changes) {
    await mock(page, change)
    await page.waitForTimeout(150)
    check(JSON.stringify(await tabs()) === JSON.stringify(order), `tab order unchanged after ${change}`)
  }

  // With an event soon the island opens on Calendar, and Calendar is the same agenda, not a view of its own.
  await away()
  await mock(page, 'hover(false)')
  await page.waitForTimeout(500)
  await mock(page, 'hover(true)')
  await waitState(page, 'expanded')
  await settle(page)
  check((await selectedTab(page)) === 'Calendar', `with an event soon the island opens on its tab (${await selectedTab(page)})`)
  const content = page.locator('#island [data-island-content]')
  await content.getByText('Sync with Alex').first().waitFor({ timeout: 4000 })
  check(await content.getByText('Design standup').count(), 'the calendar tab keeps its agenda during the event: the next event leads, the rest of the day follows')
  await away()
  await mock(page, 'hover(false)')

  // A fresh profile: five tabs and the gear, all tabs in the left wing.
  const fresh = await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 2 })
  await fresh.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.clear()
    // The fixtures and the library plugins the mock also serves are not part of the built-in set.
    for (const id of ['hello-plugin', 'timer-plugin', 'github', 'youtrack']) localStorage.setItem(`notch:mock:enabled:${id}`, 'false')
  })
  const first = await fresh.newPage()
  watch(first)
  await first.goto(url)
  await first.waitForSelector('#island')
  await first.evaluate('window.__notchMock.hover(true)')
  await waitState(first, 'expanded')
  await settle(first)
  const labels = await first.$$eval('#island [role=tab]', (t) => t.map((el) => el.getAttribute('aria-label')))
  const wings = await first.evaluate(() => {
    const island = document.querySelector('#island')!.getBoundingClientRect()
    const mid = island.left + island.width / 2
    const gear = document.querySelector('#island button[aria-label="Settings"]')!.getBoundingClientRect()
    return { left: [...document.querySelectorAll('#island [role=tab]')].every((t) => t.getBoundingClientRect().right < mid), gearRight: gear.left > mid }
  })
  check(labels.length === 5 && wings.left && wings.gearRight, `a fresh profile shows five tabs on the left wing and the gear alone on the right: ${labels.join(', ')}`)
  await shoot(first, 'ws-a-fresh-profile')
  await fresh.close()

  // Display modes: `pill` draws nothing at idle, the island only for activities, flashes and hover; `hidden` no island,
  // while the launcher still drops from the panel.
  const outline = async () => Math.round((await page.locator('#island > svg path').first().boundingBox())?.height ?? 0)
  const setMode = async (mode: string) => {
    await host(page, 'app.setPreferences', { displayModes: { mock: mode } })
    await page.waitForFunction((m) => document.querySelector('#island')?.getAttribute('data-mode') === m, mode)
    await settle(page)
  }
  await away()
  await mock(page, 'hover(false)')
  await mock(page, 'stopMedia()')
  // Nothing active: the event and the download from above go with their plugins.
  for (const id of ['calendar', 'recent-files']) await enable(page, id, false)
  await waitState(page, 'idle')
  await settle(page)
  const fullIdle = await outline()
  await setMode('pill')
  const pillIdle = await outline()
  check(fullIdle >= 30 && pillIdle <= 2, `pill: nothing at idle, the shape settles into the top edge (${fullIdle} → ${pillIdle}px)`)
  await shoot(page, 'ws-a-pill-idle')
  await mock(page, 'startMedia()')
  await waitState(page, 'compact')
  await settle(page)
  check((await outline()) >= 30, `pill: an activity grows the island out of the edge (${await outline()}px)`)
  await shoot(page, 'ws-a-pill-activity')
  await mock(page, 'stopMedia()')
  await waitState(page, 'idle')
  await mock(page, 'hover(true)')
  await waitState(page, 'expanded')
  await settle(page)
  check((await outline()) > 100, `pill: hover opens the island (${await outline()}px)`)
  await shoot(page, 'ws-a-pill-hover')
  await away()
  await mock(page, 'hover(false)')
  await waitState(page, 'idle')
  await settle(page)
  check((await outline()) <= 2, 'pill: leaving it settles back into the edge')

  await setMode('hidden')
  await mock(page, 'startMedia()')
  await page.waitForTimeout(600)
  await mock(page, 'hover(true)')
  await page.waitForTimeout(600)
  check((await state(page)) === 'idle' && (await outline()) <= 2, 'hidden: no island for an activity or a hover')
  await mock(page, 'hover(false)')
  await mock(page, 'launcher()')
  const search = page.getByPlaceholder(/Search/)
  await search.waitFor({ timeout: 4000 })
  check(await search.isVisible(), 'hidden: the launcher still drops from the panel')
  await settle(page)
  await shoot(page, 'ws-a-hidden-launcher', true)
  await page.keyboard.press('Escape')
  await search.waitFor({ state: 'hidden', timeout: 4000 })
  await setMode('full')
  await waitState(page, 'compact')
  check((await outline()) >= 30, 'back to full: the island shows its activity again')
  await mock(page, 'stopMedia()')
  for (const id of ['calendar', 'recent-files']) await enable(page, id, true)
}

check(errors.length === 0, `no console errors${errors.length ? `:\n${errors.join('\n')}` : ''}`)
await browser.close()
