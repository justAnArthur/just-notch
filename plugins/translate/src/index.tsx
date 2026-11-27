import { List } from '@justanarthur/modo-ui'
import { definePlugin, type PluginContext, type SearchItem, SelectRow, type Translated, useStorage } from '@just-notch/sdk'
import { Languages, TriangleAlert } from 'lucide-react'

const TARGET = 'target'
const LANGUAGES_SETTINGS = 'x-apple.systempreferences:com.apple.Localization-Settings.extension'
const TARGETS = [
  { value: '', label: 'My language (English for text already in it)' },
  ...['en', 'uk', 'de', 'fr', 'es', 'it', 'pl', 'pt', 'ja', 'zh', 'ko', 'ar', 'tr', 'nl', 'ru'].map((code) => ({
    value: code,
    label: new Intl.DisplayNames(undefined, { type: 'language' }).of(code) ?? code,
  })),
]

const languageName = (code: string) => new Intl.DisplayNames(undefined, { type: 'language' }).of(code) ?? code

async function translate(ctx: PluginContext, query: string, signal: AbortSignal): Promise<SearchItem[]> {
  let text = query.trim()
  let fromClipboard = false
  if (!text) {
    text = (await ctx.call('clipboard.readText', {}).catch(() => ({ text: '' }))).text.trim()
    fromClipboard = true
  }
  if (!text) return []
  const to = (await ctx.storage.get<string>(TARGET)) || undefined
  try {
    const result: Translated = await ctx.call('text.translate', { text, to })
    if (signal.aborted) return []
    return [
      {
        id: 'translation',
        title: result.text,
        subtitle: `${languageName(result.from)} → ${languageName(result.to)}${fromClipboard ? ' · what you copied' : ''}`,
        icon: Languages,
        preview: { text: result.text, details: [{ label: 'Original', value: text.length > 300 ? `${text.slice(0, 300)}…` : text }] },
        actions: [{ title: 'Copy', run: async () => void (await ctx.call('clipboard.writeText', { text: result.text })) }],
      },
    ]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [
      {
        id: 'error',
        title: message,
        subtitle: 'Translate',
        icon: TriangleAlert,
        actions: /Download/.test(message) ? [{ title: 'Open Language & Region', run: async () => void (await ctx.call('system.openUrl', { url: LANGUAGES_SETTINGS })) }] : [],
      },
    ]
  }
}

function Settings() {
  const [target, setTarget] = useStorage(TARGET, '')
  return (
    <List>
      <List.Section title="Translate">
        <SelectRow
          label="Translate into"
          description="Language pairs work once your Mac has them: System Settings › General › Language & Region › Translation Languages."
          options={TARGETS}
          value={target}
          onValueChange={setTarget}
        />
      </List.Section>
    </List>
  )
}

export default definePlugin({
  settings: Settings,
  search: {
    title: 'Translate',
    icon: Languages,
    keywords: ['tr', 'translate'],
    // Inside its scope only: every keystroke elsewhere would translate the query.
    root: false,
    debounce: 300,
    timeout: 6000,
    provide: (query, { ctx, signal }) => translate(ctx, query, signal),
  },
})
