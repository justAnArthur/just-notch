import { IslandFlash } from '@justanarthur/modo-ui-notch'
import { signal } from '@just-notch/sdk'
import { CircleAlert } from 'lucide-react'
import { dispatch } from '../activity/store'
import type { Row } from './rows'

const FAILED_MS = 3500
/** The title of the row whose action failed, for the flash. */
const failed = signal('')

function Failed() {
  const title = failed.use()
  return <IslandFlash tone="error" icon={<CircleAlert size={20} strokeWidth={1.75} />} title={`Couldn't run “${title}”`} caption="Try again, or check its settings." />
}

/**
 * Says in the island that a row's action failed, since the launcher has already gone. The flash runs as the row's
 * plugin: a flash is drawn inside its plugin's context, so a built-in row (no plugin) only logs.
 */
export function showFailure(row: Row, error: unknown) {
  console.error(error)
  if (!row.plugin) return
  failed.set(row.title)
  dispatch({ type: 'flash', plugin: row.plugin, spec: { priority: 'alert', key: 'launcher.failed', view: Failed, durationMs: FAILED_MS } })
}
