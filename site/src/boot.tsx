import 'virtual:uno.css'
import '@justanarthur/modo-ui/base.css'
import './brand/brand.css'
import './styles.css'
import { type ReactNode, StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'

/** Every page's start: the shared styles, then its root, hydrated when the build prerendered it. */
export function mount(page: ReactNode) {
  const root = document.getElementById('root') as HTMLElement
  const app = <StrictMode>{page}</StrictMode>
  if (root.hasChildNodes()) hydrateRoot(root, app)
  else createRoot(root).render(app)
}
