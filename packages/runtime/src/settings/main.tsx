import 'virtual:uno.css'
import '../styles.css'
import { createRoot } from 'react-dom/client'
import { installDispatch } from '../host/bus'
import { installMockHost } from '../host/mock'
import { ready } from '../host/session'
import Settings from './settings'

if (!window.webkit) installMockHost()
installDispatch()

const info = await ready()
createRoot(document.getElementById('root') as HTMLElement).render(<Settings info={info} />)
