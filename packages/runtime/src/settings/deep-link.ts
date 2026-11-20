import { on } from '../host/bus'
import { call } from '../host/client'
import { type SettingsTarget, setSettingsTarget } from './target'

const PLUGIN_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** The pages a `justnotch://settings/<page>` link may open; the menu bar's warning item opens `permissions`. */
const PAGES = new Set(['general', 'launcher', 'plugins', 'library', 'permissions', 'about'])

/**
 * `justnotch://library` opens the Library page, `justnotch://library/<id>` that plugin's page in it, and
 * `justnotch://settings/<page>` a settings page (General without one). Links never install.
 */
export function deepLinkTarget(url: string): SettingsTarget | undefined {
  if (!URL.canParse(url)) return undefined
  const { protocol, hostname, pathname } = new URL(url)
  if (protocol !== 'justnotch:') return undefined
  const id = pathname.replace(/^\/+|\/+$/g, '')
  if (hostname === 'settings') {
    const page = id || 'general'
    return PAGES.has(page) ? { page } : undefined
  }
  if (hostname !== 'library') return undefined
  if (!id) return { page: 'library' }
  return PLUGIN_ID.test(id) ? { page: 'library', library: id } : undefined
}

/** Opens the island's settings where a `justnotch://` link points, at launch and while running. */
export function followDeepLinks() {
  const follow = (url: string | null) => {
    const target = url ? deepLinkTarget(url) : undefined
    if (!target) return
    setSettingsTarget(target)
    void call('runtime', 'window.openSettings', {})
  }
  void call('runtime', 'deepLinks.initial', {}).then(({ url }) => follow(url))
  return on('deepLink.open', ({ url }) => follow(url))
}
