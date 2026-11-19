import 'virtual:uno.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import { installDispatch, on } from './host/bus'
import { log } from './host/client'
import DevToolbar from './host/dev-toolbar'
import { installMockHost, mock } from './host/mock'
import { ready, useGeometry } from './host/session'
import { createSwiftHost } from './host/swift-host'
import Island from './island/island'
import Launcher from './launcher/launcher'
import { syncPlugins } from './plugins/loader'
import { followDeepLinks } from './settings/deep-link'

const isMock = !window.webkit
if (isMock) {
  installMockHost()
  Object.assign(window, { __notchMock: mock })
  document.documentElement.dataset.notch = 'mock'
}
installDispatch()
// The host has no console: page errors go to its log.
window.addEventListener('error', (event) => log('error', `${event.message} at ${event.filename}:${event.lineno}`))
window.addEventListener('unhandledrejection', (event) => log('error', `unhandled rejection: ${String(event.reason)}`))

function App() {
  const geometry = useGeometry()
  if (!geometry) return null
  const island = (
    <div className="relative shrink-0" style={{ width: geometry.panel.w, height: geometry.panel.h }}>
      <Island geometry={geometry} />
      <Launcher geometry={geometry} />
    </div>
  )
  if (!isMock) return island
  return (
    <div className="flex min-h-screen flex-col items-center gap-6">
      {island}
      <DevToolbar />
    </div>
  )
}

const info = await ready()
const host = createSwiftHost({ name: 'just-notch', version: info.version })
if (isMock) Object.assign(window, { __notchHost: host })
on('plugins.changed', ({ plugins }) => void syncPlugins(plugins))
void syncPlugins(info.plugins)
followDeepLinks()
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
