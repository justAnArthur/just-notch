import 'virtual:uno.css'
import '../styles.css'
import { createRoot } from 'react-dom/client'
import { installDispatch } from '../host/bus'
import { log } from '../host/client'
import { installMockHost } from '../host/mock'
import { ready } from '../host/session'
import Onboarding from './onboarding'

// The Welcome window's page; in a browser it runs on the mock host, as the island's does.
if (!window.webkit) installMockHost()
installDispatch()
window.addEventListener('error', (event) => log('error', `onboarding: ${event.message} at ${event.filename}:${event.lineno}`))
window.addEventListener('unhandledrejection', (event) => log('error', `onboarding: unhandled rejection: ${String(event.reason)}`))

await ready()
createRoot(document.getElementById('root') as HTMLElement).render(<Onboarding />)
