import type { Rect } from '@just-notch/bridge-schema'
import { call } from '../host/client'

/** Base UI portals every popup (menus, selects, tooltips) to <body>; its positioner is the popup's box. */
export const POPUP_SELECTOR = '[data-base-ui-portal]'
const POSITIONER_SELECTOR = `${POPUP_SELECTOR} > [data-side]:not([data-closed])`

let island: Rect[] = []
let launcher: Rect[] = []
let popups: Rect[] = []
let sent = ''

function send() {
  const rects = [...island, ...launcher, ...popups]
  const key = JSON.stringify(rects)
  if (key === sent) return
  sent = key
  void call('runtime', 'window.setHitRegions', { rects }).catch(() => {})
}

/** The island's own regions; open popups are added to them. */
export function setIslandRegions(rects: Rect[]) {
  island = rects
  send()
}

/** The launcher's regions while it's open; empty once it has closed. */
export function setLauncherRegions(rects: Rect[]) {
  launcher = rects
  send()
}

/** Popup rects in panel coordinates: relative to the island's root, which sits at the panel's origin. */
function measure(root: Element) {
  const origin = root.getBoundingClientRect()
  popups = [...document.querySelectorAll(POSITIONER_SELECTOR)]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }))
  send()
}

/**
 * Keeps open popups in the hit regions, so a menu that reaches past the island stays clickable.
 * Mutations inside the island itself (its motion values write styles every frame) are ignored.
 */
export function trackPopups(root: Element): () => void {
  let frame = 0
  const observer = new MutationObserver((records) => {
    if (frame || records.every((r) => root.contains(r.target))) return
    frame = requestAnimationFrame(() => {
      frame = 0
      measure(root)
    })
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-side', 'data-closed'] })
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
}
