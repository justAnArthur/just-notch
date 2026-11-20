import 'virtual:uno.css'
import '../styles.css'
import { createRoot } from 'react-dom/client'
import { installDispatch } from '../host/bus'
import { log } from '../host/client'
import { installMockHost } from '../host/mock'
import { ready } from '../host/session'
import Onboarding from './onboarding'
import WhatsNew from './whats-new-page'

// The Welcome window's page (and What's New); in a browser it runs on the mock host, as the island's does.
if (!window.webkit) installMockHost()
installDispatch()
window.addEventListener('error', (event) => log('error', `onboarding: ${event.message} at ${event.filename}:${event.lineno}`))
window.addEventListener('unhandledrejection', (event) => log('error', `onboarding: unhandled rejection: ${String(event.reason)}`))

// The host switches the open window between the tour and What's New by its hash.
window.addEventListener('hashchange', () => location.reload())
const { version } = await ready()
// The same window shows What's New after an update: `onboarding.html#whats-new`.
const page = location.hash === '#whats-new' ? <WhatsNew version={version} /> : <Onboarding />
createRoot(document.getElementById('root') as HTMLElement).render(page)
