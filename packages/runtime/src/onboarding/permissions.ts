import type { PermissionState, Topics } from '@just-notch/bridge-schema'

/** The Welcome tour's permission cards: what each powers, in the order the tour asks. */
export const CARDS = [
  { id: 'calendar', label: 'Calendar', description: 'Your next meeting and a countdown to it.' },
  { id: 'location', label: 'Location', description: 'Weather where you are. You can pick a city instead in the Weather settings.' },
  { id: 'files', label: 'Downloads and Desktop', description: 'Your newest downloads and screenshots.' },
  { id: 'accessibility', label: 'Accessibility', description: 'Move windows and paste from clipboard history.' },
  { id: 'automation', label: 'Media apps', description: 'Play, pause and skip in Music and Spotify.' },
] as const

export type CardId = (typeof CARDS)[number]['id']

/** The folders have no check that doesn't prompt: the recent files watcher's answer, once the card asked. */
export function filesState(access: Topics['recentFiles']['access']): PermissionState {
  return access === 'granted' ? 'allowed' : 'off'
}
