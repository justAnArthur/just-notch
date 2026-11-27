import { Button, List } from '@justanarthur/modo-ui'
import { IslandFlash, Widget, WidgetHeader, WidgetRow } from '@justanarthur/modo-ui-notch'
import { type AppInfo, definePlugin, type PluginContext, signal, SwitchRow, usePlugin, useStorage } from '@just-notch/sdk'
import { CircleCheck, CircleX, LoaderCircle, SquareTerminal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apply, formatElapsed, parseTaskLink, type RunningTask, shortElapsed } from './logic'

const SUCCESS = 'flashSuccess'
const FAILURE = 'flashFailure'
const SOURCE_LINE = 'source "/Applications/JustNotch.app/Contents/Resources/notch.zsh"'

const running = signal<RunningTask[]>([])

/** Re-renders every second while mounted: elapsed times. */
function useNow(): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

const oldest = (tasks: RunningTask[]) => tasks.reduce<RunningTask | undefined>((a, t) => (!a || t.startedAt < a.startedAt ? t : a), undefined)

function Leading() {
  return <LoaderCircle size={15} strokeWidth={2} className="animate-spin" />
}

function Trailing() {
  const tasks = running.use()
  const now = useNow()
  const first = oldest(tasks)
  if (!first) return null
  return <span className="text-xs tabular-nums">{tasks.length > 1 ? `${tasks.length}×` : shortElapsed((now - first.startedAt) / 1000)}</span>
}

function Minimal() {
  return <LoaderCircle size={13} strokeWidth={2} className="animate-spin" />
}

function Expanded() {
  const tasks = running.use()
  const now = useNow()
  return (
    <Widget>
      <WidgetHeader icon={SquareTerminal}>{tasks.length === 1 ? 'Running' : `${tasks.length} running`}</WidgetHeader>
      {tasks.map((task) => (
        <WidgetRow key={task.id} leading={formatElapsed((now - task.startedAt) / 1000)}>
          <span className="font-mono">{task.title}</span>
        </WidgetRow>
      ))}
    </Widget>
  )
}

/** Brings the terminal the command ran in to the front, by its bundle id. */
async function showApp(ctx: PluginContext, bundleId: string) {
  const apps: AppInfo[] = await ctx.call('apps.index', {}).catch(() => [])
  const path = apps.find((a) => a.bundleId === bundleId)?.path
  if (path) await ctx.call('apps.launch', { path }).catch(() => {})
}

function endFlash(ctx: PluginContext, title: string, status: number, seconds: number | undefined, app: string | undefined) {
  const ok = status === 0
  const took = seconds === undefined ? '' : formatElapsed(seconds)
  const caption = ok ? (took ? `Done in ${took}` : 'Done') : `Failed with exit code ${status}${took ? ` after ${took}` : ''}`
  const Icon = ok ? CircleCheck : CircleX
  return function EndFlash() {
    return (
      <IslandFlash
        tone={ok ? 'success' : 'error'}
        icon={<Icon size={20} strokeWidth={1.75} />}
        title={<span className="font-mono">{title}</span>}
        caption={caption}
        action={
          app ? (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                void showApp(ctx, app)
                ctx.activity.dismiss('end')
              }}
            >
              Show
            </Button>
          ) : undefined
        }
      />
    )
  }
}

function activate(ctx: PluginContext) {
  let shown = false
  const sync = (tasks: RunningTask[]) => {
    running.set(tasks)
    if (tasks.length && !shown) ctx.activity.show({ priority: 'timer', title: 'Finish Line', compact: { leading: Leading, trailing: Trailing }, minimal: Minimal, expanded: Expanded })
    if (!tasks.length && shown) ctx.activity.hide()
    shown = tasks.length > 0
  }

  const stop = ctx.on('deepLink.open', ({ url }) => {
    const link = parseTaskLink(url)
    if (!link) return
    const result = apply(running.get(), link, Date.now())
    sync(result.tasks)
    if (link.kind !== 'end') return
    const key = link.status === 0 ? SUCCESS : FAILURE
    void ctx.storage.get<boolean>(key).then((on) => {
      if (on === false) return
      ctx.activity.flash({ priority: 'alert', key: 'end', view: endFlash(ctx, link.title, link.status, result.seconds, link.app), durationMs: link.status === 0 ? 5000 : 8000 })
    })
  })

  return () => {
    stop()
    if (shown) ctx.activity.hide()
    running.set([])
  }
}

function Settings() {
  const { call } = usePlugin()
  const [success, setSuccess] = useStorage(SUCCESS, true)
  const [failure, setFailure] = useStorage(FAILURE, true)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void call('clipboard.writeText', { text: SOURCE_LINE }).then(() => setCopied(true))
  }
  return (
    <List>
      <List.Section title="Terminal">
        <List.Row
          label="Connect your shell"
          description={
            <>
              Add this line to <code>~/.zshrc</code>, then open a new terminal. Commands that run longer than 10 seconds show beside the notch; <code>notch run &lt;command&gt;</code> reports any command, and{' '}
              <code>notch done</code> flashes from a script.
              <code className="mt-2 block select-all break-all rounded bg-black/30 px-2 py-1 font-mono text-xs">{SOURCE_LINE}</code>
            </>
          }
        >
          <Button variant="secondary" size="compact" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </List.Row>
      </List.Section>
      <List.Section title="Flash when">
        <SwitchRow label="A command finishes" description="✓ with how long it took, and Show to bring its terminal forward." checked={success} onCheckedChange={setSuccess} />
        <SwitchRow label="A command fails" description="✗ with its exit code; it stays a little longer." checked={failure} onCheckedChange={setFailure} />
      </List.Section>
    </List>
  )
}

export default definePlugin({ activate, settings: Settings })
