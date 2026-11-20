import type { AppPreferences, Methods } from '@just-notch/bridge-schema'
import { Button, Kbd, List } from '@justanarthur/modo-ui'
import { SwitchRow } from '@just-notch/sdk'
import { useEffect, useState } from 'react'
import { call } from '../host/client'
import { acceleratorOf, formatAccelerator } from '../launcher/shortcut'

export type PreferenceChange = Methods['app.setPreferences']['params']

/** Spotlight's shortcut lives in Keyboard › Keyboard Shortcuts › Spotlight. */
const KEYBOARD_SHORTCUTS = 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension'

/** A button that records the next shortcut pressed; Escape cancels. */
function ShortcutRecorder({ value, onChange }: { value: string; onChange: (accelerator: string) => void }) {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape' && !event.metaKey && !event.altKey && !event.ctrlKey) return setRecording(false)
      const accelerator = acceleratorOf(event)
      if (!accelerator) return
      setRecording(false)
      onChange(accelerator)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  return (
    <Button variant="secondary" size="compact" aria-label="Change shortcut" onClick={() => setRecording(!recording)} onBlur={() => setRecording(false)}>
      {recording ? 'Press a shortcut…' : <Kbd variant="plain">{formatAccelerator(value)}</Kbd>}
    </Button>
  )
}

interface LauncherPageProps {
  preferences: AppPreferences | undefined
  error: string | undefined
  onChange: (change: PreferenceChange) => void
}

/** Settings › Launcher: on or off, and its shortcut; says why the shortcut doesn't work when it can't. */
export default function LauncherPage({ preferences, error, onChange }: LauncherPageProps) {
  if (!preferences) return null
  const { launcher } = preferences
  const shortcut = formatAccelerator(launcher.shortcut)

  return (
    <List>
      <List.Section title="Launcher">
        <SwitchRow
          label="Open with a hotkey"
          description="Search drops out of the notch. Esc or a click outside closes it."
          checked={launcher.enabled}
          onCheckedChange={(enabled) => onChange({ launcher: { enabled } })}
        />
        <List.Row label="Hotkey" description="Click, then press the keys. It needs ⌘, ⌥, ⌃ or ⇧, unless it's a function key.">
          <ShortcutRecorder value={launcher.shortcut} onChange={(next) => onChange({ launcher: { shortcut: next } })} />
        </List.Row>
        {error && <List.Row label="That hotkey didn't work" description={error} />}
        {launcher.enabled && !launcher.active && !error && (
          <List.Row label={`${shortcut} isn't available`} description="Another app uses it. Pick another hotkey." />
        )}
        {launcher.spotlightConflict && (
          <List.Row
            label={`Spotlight still uses ${shortcut}`}
            description="Turn off Show Spotlight search in Keyboard Shortcuts › Spotlight, and the launcher gets it."
          >
            <Button variant="secondary" size="compact" onClick={() => void call('runtime', 'system.openUrl', { url: KEYBOARD_SHORTCUTS })}>
              Open Keyboard Shortcuts
            </Button>
          </List.Row>
        )}
      </List.Section>
    </List>
  )
}
