import 'virtual:uno.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import { installDispatch, on } from './host/bus'
import DevToolbar from './host/dev-toolbar'
import { installMockHost, mock } from './host/mock'
import { ready, useGeometry } from './host/session'
import Island from './island/island'
import { syncPlugins } from './plugins/loader'

const isMock = !window.webkit
if (isMock) {
  installMockHost()
  Object.assign(window, { __notchMock: mock })
  document.documentElement.dataset.notch = 'mock'
}
installDispatch()

function App() {
  const geometry = useGeometry()
  if (!geometry) return null
  const island = (
    <div className="relative shrink-0" style={{ width: geometry.panel.w, height: geometry.panel.h }}>
      <Island geometry={geometry} />
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
on('plugins.changed', ({ plugins }) => void syncPlugins(plugins))
void syncPlugins(info.plugins)
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
