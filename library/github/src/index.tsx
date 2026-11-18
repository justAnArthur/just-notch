import { IslandFlash, Widget } from '@justanarthur/modo-ui-notch'
import { Button, Input, List } from '@justanarthur/modo-ui'
import { definePlugin, type PluginContext, SelectRow, signal, SwitchRow, usePlugin, useSheet, useStorage } from '@just-notch/sdk'
import {
  Check,
  CircleDashed,
  CircleDot,
  CircleX,
  GitPullRequest,
  GitPullRequestArrow,
  GitPullRequestDraft,
  KeyRound,
  MessageSquareDiff,
  RefreshCw,
  CloudOff,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { fetchInbox, GitHubError } from './api'
import { type Alert, type AlertKind, alerts, type Checks, type Inbox, type Issue, type PullRequest, shortRepo } from './github'

const TOKEN = 'token'
const EVERY = 'everyMinutes'
const ALERTS = 'alerts'
const NEW_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,read:org&description=Just%20Notch'
const MINUTE = 60_000
const FIT_ROWS = 4
const TALL_ROWS = 8

type Every = '1' | '2' | '5' | '15'
type AlertSettings = Record<AlertKind, boolean>
const ALL_ALERTS: AlertSettings = { review: true, failed: true, approved: true }

interface State {
  status: 'signed-out' | 'loading' | 'ready' | 'error'
  /** The last good answer, kept through a failed poll. */
  inbox?: Inbox
  error?: string
}

const state = signal<State>({ status: 'loading' })
/** Set by `activate`: polls now. */
let refresh = () => {}

const CHECKS_COLOR: Record<Checks, string> = {
  success: 'var(--status-success)',
  failure: 'var(--status-error)',
  pending: 'var(--status-warning)',
  none: 'transparent',
}

function useOpen() {
  const { call } = usePlugin()
  return (url: string) => void call('system.openUrl', { url })
}

function Item({ url, leading, color, trailing, children }: { url: string; leading: ReactNode; color?: string; trailing?: ReactNode; children: ReactNode }) {
  const open = useOpen()
  return (
    <button type="button" className="-mx-1.5 block w-[calc(100%+0.75rem)] rounded-md px-1.5 text-left hover:bg-hover" onClick={() => open(url)}>
      <Widget.Row leading={leading} color={color} trailing={trailing}>
        {children}
      </Widget.Row>
    </button>
  )
}

function ReviewGlyph({ pr }: { pr: PullRequest }) {
  if (pr.draft) return <GitPullRequestDraft size={12} strokeWidth={1.5} aria-label="Draft" />
  if (pr.review === 'approved') return <Check size={12} strokeWidth={1.5} className="text-success" aria-label="Approved" />
  if (pr.review === 'changes') return <MessageSquareDiff size={12} strokeWidth={1.5} className="text-warning" aria-label="Changes requested" />
  return null
}

function PrRow({ pr, mine, brief }: { pr: PullRequest; mine?: boolean; brief?: boolean }) {
  const repo = shortRepo(pr.repo)
  const meta = mine ? !brief && repo : brief ? pr.author : `${pr.author} · ${repo}`
  return (
    <Item
      url={pr.url}
      leading={`#${pr.number}`}
      color={mine ? CHECKS_COLOR[pr.checks] : undefined}
      trailing={
        <>
          {mine && <ReviewGlyph pr={pr} />}
          {meta && <span className="max-w-40 truncate">{meta}</span>}
        </>
      }
    >
      {pr.title}
    </Item>
  )
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <Item url={issue.url} leading={`#${issue.number}`} trailing={<span className="max-w-28 truncate">{shortRepo(issue.repo)}</span>}>
      {issue.title}
    </Item>
  )
}

function Section<T>({ label, items, rows, empty, render }: { label: string; items: T[]; rows: number; empty: string; render: (item: T) => ReactNode }) {
  return (
    <Widget.Section label={label} trailing={items.length > rows ? `${rows} of ${items.length}` : undefined}>
      {items.length === 0 ? <Widget.Row>{<span className="text-muted-foreground">{empty}</span>}</Widget.Row> : items.slice(0, rows).map(render)}
    </Widget.Section>
  )
}

const Reviews = ({ inbox, rows, brief }: { inbox: Inbox; rows: number; brief?: boolean }) => (
  <Section label="Review requests" items={inbox.reviews} rows={rows} empty="Nothing waiting for you" render={(pr) => <PrRow key={pr.url} pr={pr} brief={brief} />} />
)
const Mine = ({ inbox, rows, brief }: { inbox: Inbox; rows: number; brief?: boolean }) => (
  <Section label="Your pull requests" items={inbox.mine} rows={rows} empty="No open pull requests" render={(pr) => <PrRow key={pr.url} pr={pr} mine brief={brief} />} />
)
const Issues = ({ inbox, rows }: { inbox: Inbox; rows: number }) => (
  <Section label="Assigned issues" items={inbox.issues} rows={rows} empty="No issues assigned" render={(issue) => <IssueRow key={issue.url} issue={issue} />} />
)

function Header({ inbox, error }: { inbox: Inbox; error?: string }) {
  return (
    <Widget.Header icon={GitPullRequest} trailing={<Widget.Action icon={RefreshCw} label="Refresh" onClick={() => refresh()} />}>
      {error ? `@${inbox.login} · ${error}` : `@${inbox.login}`}
    </Widget.Header>
  )
}

function View() {
  const { status, inbox, error } = state.use()
  const layout = useSheet()

  if (status === 'signed-out')
    return <Widget.Message icon={KeyRound} title="Connect GitHub" description="Add a personal access token in the GitHub plugin's settings." />
  if (!inbox && status === 'error')
    return (
      <Widget.Message
        icon={CloudOff}
        title="GitHub didn't answer"
        description={error}
        actions={
          <Button variant="secondary" size="compact" onClick={() => refresh()}>
            Try again
          </Button>
        }
      />
    )
  if (!inbox) return <Widget.Message icon={CircleDashed} title="Checking GitHub…" />

  const failing = inbox.mine.filter((pr) => pr.checks === 'failure').length

  if (layout === 'tall')
    return (
      <Widget.Sheet>
        <Header inbox={inbox} error={error} />
        <Reviews inbox={inbox} rows={TALL_ROWS} />
        <Mine inbox={inbox} rows={TALL_ROWS} />
        <Issues inbox={inbox} rows={TALL_ROWS} />
      </Widget.Sheet>
    )

  return (
    <Widget aside={inbox.reviews.length ? <Reviews inbox={inbox} rows={FIT_ROWS} brief /> : <Mine inbox={inbox} rows={FIT_ROWS} brief />}>
      <Header inbox={inbox} error={error} />
      <Widget.Figure value={inbox.reviews.length} unit={inbox.reviews.length === 1 ? 'review waiting' : 'reviews waiting'} />
      <Widget.Meta>
        <Widget.MetaItem icon={GitPullRequestArrow}>{inbox.mine.length} open</Widget.MetaItem>
        {failing > 0 && <Widget.MetaItem icon={CircleX}>{failing} failing</Widget.MetaItem>}
        <Widget.MetaItem icon={CircleDot}>{inbox.issues.length} issues</Widget.MetaItem>
      </Widget.Meta>
    </Widget>
  )
}

const FLASH: Record<AlertKind, { title: string; tone: 'info' | 'error' | 'success'; icon: typeof Check }> = {
  review: { title: 'Review requested', tone: 'info', icon: GitPullRequest },
  failed: { title: 'Checks failed', tone: 'error', icon: CircleX },
  approved: { title: 'Pull request approved', tone: 'success', icon: Check },
}

function flashView({ kind, pr }: Alert) {
  const { title, tone, icon: Icon } = FLASH[kind]
  return () => (
    <IslandFlash
      title={title}
      caption={`${shortRepo(pr.repo)} #${pr.number} · ${pr.title}`}
      icon={<Icon size={18} strokeWidth={1.5} />}
      tone={tone}
    />
  )
}

function TokenSettings() {
  const { inbox, status, error } = state.use()
  const [token, setToken] = useStorage(TOKEN, '')
  const [draft, setDraft] = useState(token)
  useEffect(() => setDraft(token), [token])
  const open = useOpen()

  const save = () => {
    const next = draft.trim()
    if (next !== token) setToken(next)
  }
  const description =
    token && inbox ? `Signed in as @${inbox.login}.` : 'A classic token with the repo scope, or a fine-grained one that reads pull requests and issues.'

  return (
    <List.Section title="Account">
      <List.Row label="Personal access token" description={status === 'error' && token ? error : description}>
        <Input
          aria-label="Personal access token"
          type="password"
          icon={KeyRound}
          value={draft}
          placeholder="ghp_…"
          className="w-48"
          onValueChange={setDraft}
          onBlur={save}
          onKeyDown={(event) => event.key === 'Enter' && save()}
        />
      </List.Row>
      <List.Row label={token ? 'Sign out' : 'New token'} description={token ? 'Forgets the token on this Mac.' : 'Opens GitHub with the scopes filled in.'}>
        {token ? (
          <Button variant="secondary" size="compact" onClick={() => setToken('')}>
            Sign out
          </Button>
        ) : (
          <Button variant="secondary" size="compact" onClick={() => open(NEW_TOKEN_URL)}>
            Create on GitHub
          </Button>
        )}
      </List.Row>
    </List.Section>
  )
}

function Settings() {
  const [every, setEvery] = useStorage<Every>(EVERY, '2')
  const [on, setOn] = useStorage(ALERTS, ALL_ALERTS)
  const toggle = (kind: AlertKind) => (checked: boolean) => setOn({ ...on, [kind]: checked })
  return (
    <List>
      <TokenSettings />
      <List.Section title="Alerts">
        <SwitchRow label="Review requested" description="Flashes when a pull request asks for your review." checked={on.review} onCheckedChange={toggle('review')} />
        <SwitchRow label="Checks failed" description="Flashes when CI turns red on one of your pull requests." checked={on.failed} onCheckedChange={toggle('failed')} />
        <SwitchRow label="Approved" description="Flashes when one of your pull requests is approved." checked={on.approved} onCheckedChange={toggle('approved')} />
      </List.Section>
      <List.Section title="Updates">
        <SelectRow
          label="Check GitHub"
          options={[
            { value: '1', label: 'Every minute' },
            { value: '2', label: 'Every 2 minutes' },
            { value: '5', label: 'Every 5 minutes' },
            { value: '15', label: 'Every 15 minutes' },
          ]}
          value={every}
          onValueChange={setEvery}
        />
      </List.Section>
    </List>
  )
}

/** Polls GitHub while enabled and flashes what changed; the views read `state`. */
function activate(ctx: PluginContext) {
  let token = ''
  let every: Every = '2'
  let enabled = ALL_ALERTS
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Bumped per poll, so an answer that arrives after a newer poll started is dropped. */
  let run = 0

  const poll = async () => {
    clearTimeout(timer)
    const mine = ++run
    if (!token) return state.set({ status: 'signed-out' })
    const before = state.get().inbox
    state.set({ ...state.get(), status: 'loading' })
    try {
      const inbox = await fetchInbox(token)
      if (mine !== run) return
      state.set({ status: 'ready', inbox })
      for (const alert of alerts(before, inbox).filter((a) => enabled[a.kind]))
        ctx.activity.flash({ priority: 'alert', view: flashView(alert), durationMs: 5000 })
    } catch (error) {
      if (mine !== run) return
      const auth = error instanceof GitHubError && error.auth
      state.set({ status: 'error', inbox: auth ? undefined : before, error: error instanceof Error ? error.message : String(error) })
    }
    timer = setTimeout(poll, Number(every) * MINUTE)
  }
  refresh = () => void poll()

  const stops = [
    ctx.storage.subscribe<string>(TOKEN, (next) => {
      token = next ?? ''
      state.set({ status: 'loading' })
      void poll()
    }),
    ctx.storage.subscribe<Every>(EVERY, (next) => {
      every = next ?? '2'
      void poll()
    }),
    ctx.storage.subscribe<AlertSettings>(ALERTS, (next) => {
      enabled = next ?? ALL_ALERTS
    }),
  ]
  void Promise.all([ctx.storage.get<string>(TOKEN), ctx.storage.get<Every>(EVERY), ctx.storage.get<AlertSettings>(ALERTS)]).then(([t, e, a]) => {
    token = t ?? ''
    every = e ?? every
    enabled = a ?? enabled
    void poll()
  })

  return () => {
    run++
    clearTimeout(timer)
    refresh = () => {}
    for (const stop of stops) stop()
  }
}

export default definePlugin({
  activate,
  widget: { title: 'GitHub', icon: GitPullRequest, view: View },
  settings: Settings,
})
