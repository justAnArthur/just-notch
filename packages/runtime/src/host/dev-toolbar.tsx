import { Button, SizeProvider } from '@justanarthur/modo-ui'
import { useEffect, useState } from 'react'
import { present } from '../activity/reducer'
import { useActivityState } from '../activity/store'
import { mock } from './mock'

const ACTIONS: { label: string; run: () => void }[] = [
  { label: 'Hover in', run: () => mock.hover(true) },
  { label: 'Hover out', run: () => mock.hover(false) },
  { label: 'Charger', run: mock.charger },
  { label: 'Volume', run: () => mock.volume() },
  { label: 'AirPods', run: mock.airpods },
  { label: 'File drag', run: mock.fileDrag },
  { label: 'Play / pause', run: () => void mock.togglePlay() },
]

/** Mock mode only, outside the island: fires what the real host would. */
export default function DevToolbar() {
  const island = present(useActivityState()).island
  const [regions, setRegions] = useState('')

  useEffect(() => {
    const timer = setInterval(() => setRegions(mock.hitRegions.rects.map((r) => `${r.w}×${r.h}`).join(' + ')), 250)
    return () => clearInterval(timer)
  }, [])

  return (
    <SizeProvider size="compact">
      <div id="dev-toolbar" className="flex flex-col items-center gap-3">
        <div className="flex flex-wrap justify-center gap-2">
          {ACTIONS.map((action) => (
            <Button key={action.label} variant="secondary" onClick={action.run}>
              {action.label}
            </Button>
          ))}
        </div>
        <p className="text-caption text-muted-foreground">
          {island} · hit {regions || 'none'}
        </p>
      </div>
    </SizeProvider>
  )
}
