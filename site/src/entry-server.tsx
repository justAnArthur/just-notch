import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { App } from './App'
import { Changelog } from './pages/Changelog'
import { Developers } from './pages/Developers'

const PAGES = { home: App, changelog: Changelog, developers: Developers }

export type PageName = keyof typeof PAGES

/** A page's HTML for the build to put in its #root, so it paints before the JavaScript runs. */
export function render(name: PageName) {
  const Page = PAGES[name]
  return renderToString(
    <StrictMode>
      <Page />
    </StrictMode>,
  )
}
