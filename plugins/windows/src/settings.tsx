import { Button, Kbd, List } from '@justanarthur/modo-ui'
import { SwitchRow, useStorage } from '@just-notch/sdk'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { bindings, type Command, COMMANDS } from './commands'
import { problems, setRecording, STORAGE } from './hotkeys'
import { acceleratorOf, formatAccelerator, reservedBy } from './shortcut'

type Overrides = Record<string, string | null>

/** Records the next shortcut pressed: Escape cancels, ⌫ on its own clears it. */
function Recorder({ title, value, onChange }: { title: string; value: string | null; onChange: (accelerator: string | null) => void }) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!active) return
    setRecording(true)
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const bare = !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
      if (bare && event.key === 'Escape') return setActive(false)
      if (bare && event.key === 'Backspace') {
        setActive(false)
        return onChange(null)
      }
      const accelerator = acceleratorOf(event)
      if (!accelerator) return
      setActive(false)
      onChange(accelerator)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setRecording(false)
    }
  }, [active])

  return (
    <Button variant="secondary" size="compact" aria-label={`Change the shortcut for ${title}`} onClick={() => setActive(!active)} onBlur={() => setActive(false)}>
      {active ? 'Press a shortcut…' : value ? <Kbd variant="plain">{formatAccelerator(value)}</Kbd> : 'None'}
    </Button>
  )
}

function CommandRow({ command, value, problem, onChange }: { command: Command; value: string | null; problem?: string; onChange: (accelerator: string | null) => void }) {
  const reserved = value && reservedBy(value)
  const description = problem ?? (reserved ? `macOS keeps this for ${reserved}` : undefined)
  return (
    <List.Row label={command.title} description={description}>
      <div className="flex items-center gap-1">
        <Recorder title={command.title} value={value} onChange={onChange} />
        {value && (
          <Button variant="ghost" size="icon-compact" aria-label={`Clear the shortcut for ${command.title}`} onClick={() => onChange(null)}>
            <X />
          </Button>
        )}
      </div>
    </List.Row>
  )
}

/** Settings › Window Management: the master switch, cycling, and every command's rebindable shortcut. */
export default function Settings() {
  const [enabled, setEnabled] = useStorage(STORAGE.enabled, true)
  const [cycling, setCycling] = useStorage(STORAGE.cycling, true)
  const [overrides, setOverrides] = useStorage<Overrides>(STORAGE.bindings, {})
  const issues = problems.use()
  const bound = bindings(overrides)
  const changed = Object.keys(overrides).length > 0
  const conflicts = COMMANDS.filter((c) => issues[c.id] || reservedBy(bound.get(c.id) ?? '')).length

  const bind = (command: Command, accelerator: string | null) => {
    const next = { ...overrides }
    if (accelerator === command.accelerator) delete next[command.id]
    else next[command.id] = accelerator
    setOverrides(next)
  }

  return (
    <List>
      <List.Section title="Hotkeys">
        <SwitchRow
          label="Window hotkeys"
          description="Move the front window from any app with ⌃⌥ and a key, as in Rectangle."
          checked={enabled}
          onCheckedChange={setEnabled}
        />
        <SwitchRow
          label="Repeat to cycle"
          description="Press a half again for two thirds, then one third. Thirds step along the screen."
          checked={cycling}
          onCheckedChange={setCycling}
        />
      </List.Section>
      {enabled && (
        <List.Section title="Shortcuts" aside={conflicts ? `${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'}` : undefined}>
          {COMMANDS.map((command) => (
            <CommandRow key={command.id} command={command} value={bound.get(command.id) ?? null} problem={issues[command.id]} onChange={(a) => bind(command, a)} />
          ))}
          <List.Row label="Defaults" description="Rectangle's ⌃⌥ layout.">
            <Button variant="secondary" size="compact" disabled={!changed} onClick={() => setOverrides({})}>
              Reset All
            </Button>
          </List.Row>
        </List.Section>
      )}
    </List>
  )
}
