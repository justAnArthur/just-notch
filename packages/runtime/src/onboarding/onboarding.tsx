import type { AppPreferences, PermissionState } from '@just-notch/bridge-schema'
import { Button, Kbd, List, Switch } from '@justanarthur/modo-ui'
import { PermissionList } from '@justanarthur/modo-ui-notch'
import { type ReactNode, useEffect, useState } from 'react'
import appIcon from '../../../../assets/brand/icon.svg'
import { call } from '../host/client'
import { subscribeTopic } from '../host/topics'
import { formatAccelerator } from '../launcher/shortcut'
import { CARDS, type CardId, filesState } from './permissions'

const PRIVACY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_'
const PANES: Record<CardId, string> = {
  calendar: 'Calendars',
  location: 'LocationServices',
  files: 'FilesAndFolders',
  accessibility: 'Accessibility',
  automation: 'Automation',
}
const STEPS = ['welcome', 'island', 'launcher', 'permissions', 'done'] as const
type Step = (typeof STEPS)[number]

const finish = () => void call('runtime', 'onboarding.finish', {})

function Frame({ step, title, lead, children, next, onBack }: {
  step: Step
  title: string
  lead?: ReactNode
  children?: ReactNode
  next: ReactNode
  onBack?: () => void
}) {
  const index = STEPS.indexOf(step)
  return (
    // The window's title bar is transparent over the top 28 px: Skip sits in it.
    <main className="flex h-screen flex-col gap-4 px-10 pt-2 pb-8 text-foreground">
      <header className="flex h-8 items-center justify-end">
        {step !== 'done' && (
          <Button variant="ghost" size="compact" onClick={finish}>
            Skip
          </Button>
        )}
      </header>
      <section className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-title weight-semibold">{title}</h1>
          {lead && <p className="m-0 text-body text-muted-foreground">{lead}</p>}
        </div>
        {children}
      </section>
      <footer className="flex items-center justify-between">
        <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={index + 1}>
          {STEPS.map((s, i) => (
            <span key={s} className={`size-1.5 rounded-full ${i === index ? 'bg-foreground' : 'bg-muted-foreground/40'}`} />
          ))}
        </div>
        <div className="flex gap-2">
          {onBack && (
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
          )}
          {next}
        </div>
      </footer>
    </main>
  )
}

/** The permissions the cards show, read every 2 s while the step is open: a grant in System Settings shows here. */
function usePermissionStates(active: boolean) {
  const [states, setStates] = useState<Partial<Record<CardId, PermissionState>>>({ files: 'notAsked' })
  const put = (id: CardId, state: PermissionState) => setStates((current) => (current[id] === state ? current : { ...current, [id]: state }))
  useEffect(() => {
    if (!active) return
    const check = () => {
      for (const { id } of CARDS)
        if (id !== 'files') void call('runtime', 'permissions.state', { permission: id }).then((r) => put(id, r.state), () => {})
    }
    check()
    const timer = setInterval(check, 2000)
    return () => clearInterval(timer)
  }, [active])
  return [states, put] as const
}

function Permissions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [states, put] = usePermissionStates(true)
  const [watchingFiles, setWatchingFiles] = useState(false)
  // Subscribing starts the recent files scan, which is what asks for the folders: only after the card's click.
  useEffect(() => (watchingFiles ? subscribeTopic('recentFiles', ({ access }) => put('files', filesState(access))) : undefined), [watchingFiles])

  const fix = (id: string, state: PermissionState) => {
    const card = id as CardId
    if (state !== 'notAsked') return void call('runtime', 'system.openUrl', { url: PRIVACY + PANES[card] })
    if (card === 'files') return setWatchingFiles(true)
    void call('runtime', 'permissions.request', { permission: card }).then((r) => put(card, r.state), () => {})
  }

  return (
    <Frame
      step="permissions"
      title="Choose what it can see"
      lead="Nothing is asked until you click. You can change each one later in Settings › Permissions."
      onBack={onBack}
      next={<Button onClick={onNext}>Continue</Button>}
    >
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        <PermissionList
          title="Pick the ones you want"
          permissions={CARDS.map((card) => ({
            ...card,
            state: states[card.id],
            note:
              card.id !== 'accessibility'
                ? undefined
                : states.accessibility === 'notAsked'
                  ? 'macOS asks, then opens System Settings: turn on Just Notch and come back.'
                  : states.accessibility === 'stale'
                    ? "System Settings shows it as on, but macOS isn't honouring it. Fix opens the list: remove Just Notch with −, add it back with +, then come back."
                    : undefined,
          }))}
          onFix={fix}
        />
      </div>
    </Frame>
  )
}

function Launcher({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [preferences, setPreferences] = useState<AppPreferences>()
  useEffect(() => void call('runtime', 'app.preferences', {}).then(setPreferences, () => {}), [])
  const launcher = preferences?.launcher
  return (
    <Frame
      step="launcher"
      title="Search from anywhere"
      lead={
        launcher?.enabled === false
          ? 'The launcher is off. Turn it on in Settings › Launcher.'
          : 'Press the shortcut in any app: search drops out of the notch. Type an app name, a file, or a sum like 12*7.'
      }
      onBack={onBack}
      next={<Button onClick={onNext}>Next</Button>}
    >
      {launcher?.enabled !== false && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <Kbd className="text-title">{formatAccelerator(launcher?.shortcut ?? 'Alt+Space')}</Kbd>
          {launcher?.spotlightConflict && (
            <p className="m-0 max-w-96 text-center text-caption text-muted-foreground">
              Spotlight uses this shortcut too. Pick another in Settings › Launcher, or turn Spotlight's off in Keyboard Shortcuts.
            </p>
          )}
        </div>
      )}
    </Frame>
  )
}

function Done({ onBack }: { onBack: () => void }) {
  const [preferences, setPreferences] = useState<AppPreferences>()
  useEffect(() => void call('runtime', 'app.preferences', {}).then(setPreferences, () => {}), [])
  const setLaunchAtLogin = (launchAtLogin: boolean) => {
    setPreferences((current) => current && { ...current, launchAtLogin })
    void call('runtime', 'app.setPreferences', { launchAtLogin }).then(setPreferences, () => {})
  }
  return (
    <Frame
      step="done"
      title="You're set"
      lead="The island is above, the launcher a shortcut away. Settings are in the menu bar icon and the island's gear."
      onBack={onBack}
      next={
        <>
          <Button variant="secondary" onClick={() => void call('runtime', 'window.openSettings', {}).then(finish)}>
            Open Settings
          </Button>
          <Button onClick={finish}>Finish</Button>
        </>
      }
    >
      {preferences && (
        <List>
          <List.Row label="Launch at login" description="Starts Just Notch when you log in to your Mac.">
            <Switch aria-label="Launch at login" className="mr-3" checked={preferences.launchAtLogin} onCheckedChange={setLaunchAtLogin} />
          </List.Row>
        </List>
      )}
    </Frame>
  )
}

/** The Welcome tour: welcome, the island, the launcher, permissions one by one, done. Always skippable. */
export default function Onboarding() {
  const [step, setStep] = useState<Step>('welcome')
  const go = (offset: number) => setStep(STEPS[STEPS.indexOf(step) + offset] ?? step)
  const back = () => go(-1)
  const next = () => go(1)

  switch (step) {
    case 'welcome':
      return (
        <Frame step={step} title="Just Notch puts your notch to work" next={<Button onClick={next}>Get started</Button>}>
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <img src={appIcon} alt="" className="size-24" />
            <p className="m-0 max-w-96 text-center text-body text-muted-foreground">
              What's playing, your next meeting and the weather live in the notch, and a launcher drops out of it. Four short steps.
            </p>
          </div>
        </Frame>
      )
    case 'island':
      return (
        <Frame
          step={step}
          title="Hover the notch"
          lead="Move the pointer to the notch at the top of the screen: the island opens. Swipe down on it for more, and move away to close it."
          onBack={back}
          next={<Button onClick={next}>Next</Button>}
        >
          <div className="flex flex-1 items-start justify-center pt-6">
            <div className="h-9 w-56 rounded-b-[22px] bg-[#000] ring-1 ring-white/15" aria-hidden />
          </div>
        </Frame>
      )
    case 'launcher':
      return <Launcher onBack={back} onNext={next} />
    case 'permissions':
      return <Permissions onBack={back} onNext={next} />
    case 'done':
      return <Done onBack={back} />
  }
}
