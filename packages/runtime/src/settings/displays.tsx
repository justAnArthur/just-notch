import type { AppPreferences, DisplayMode } from '@just-notch/bridge-schema'
import { List } from '@justanarthur/modo-ui'
import { SelectRow, SwitchRow } from '@just-notch/sdk'
import type { PreferenceChange } from './launcher'

const MODES: { value: DisplayMode; label: string }[] = [
  { value: 'full', label: 'Full' },
  { value: 'pill', label: 'Pill' },
  { value: 'hidden', label: 'Hidden' },
]

interface DisplaysPageProps {
  preferences: AppPreferences | undefined
  onChange: (change: PreferenceChange) => void
}

/** Settings › Displays: the island's mode on each display, and when it steps aside on its own. */
export default function DisplaysPage({ preferences, onChange }: DisplaysPageProps) {
  if (!preferences) return null
  const { displays, hideWhen, hoverArea } = preferences
  return (
    <List>
      <List.Section title="Island">
        <SwitchRow
          label="Open only on the notch"
          description="The island opens once the pointer is on the notch. Off, it opens as the pointer comes near."
          checked={hoverArea === 'notch'}
          onCheckedChange={(on) => onChange({ hoverArea: on ? 'notch' : 'around' })}
        />
      </List.Section>
      <List.Section title="Displays">
        {displays.map((display) => (
          <SelectRow
            key={display.id}
            label={display.name}
            description={display.hasNotch ? 'Full keeps the island at the notch. Hidden if Apple shows its own island here.' : 'Pill shows the island only for activities and when you point at the top.'}
            options={MODES}
            value={display.mode}
            onValueChange={(mode) => onChange({ displayModes: { [display.id]: mode } })}
          />
        ))}
      </List.Section>
      <List.Section title="Step aside">
        <SwitchRow
          label="Quiet in full screen"
          description="While an app is full screen, the island keeps out of the way there: nothing playing or running shows, only volume, brightness and alerts, and it still opens when you point at the notch."
          checked={hideWhen.fullScreen}
          onCheckedChange={(fullScreen) => onChange({ hideWhen: { fullScreen } })}
        />
        <SwitchRow
          label="During calls"
          description="Hides the island while an app uses the microphone. It never shows in screen shares or recordings."
          checked={hideWhen.calls}
          onCheckedChange={(calls) => onChange({ hideWhen: { calls } })}
        />
      </List.Section>
    </List>
  )
}
