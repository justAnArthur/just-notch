import { Button } from '@justanarthur/modo-ui'
import { IslandFlash } from '@justanarthur/modo-ui-notch'
import { definePlugin, type GrabbedText, type PluginContext } from '@just-notch/sdk'
import { QrCode, ScanText, TextSelect } from 'lucide-react'

/** Long enough for the launcher to animate away before the system's crosshair appears. */
const AFTER_LAUNCHER_MS = 350

const isLink = (code: string) => /^https?:\/\//i.test(code)

function copiedFlash(text: string) {
  const lines = text.split('\n').filter(Boolean)
  return function Copied() {
    return <IslandFlash tone="success" icon={<TextSelect size={20} strokeWidth={1.75} />} title={lines[0] ?? 'Copied'} caption={lines.length > 1 ? `Copied ${lines.length} lines` : 'Copied'} />
  }
}

function codeFlash(ctx: PluginContext, code: string) {
  return function Code() {
    return (
      <IslandFlash
        icon={<QrCode size={20} strokeWidth={1.75} />}
        title={code}
        caption={isLink(code) ? 'Link from the QR code, copied' : 'From the QR code, copied'}
        action={
          isLink(code) ? (
            <Button variant="ghost" size="compact" onClick={() => void ctx.call('system.openUrl', { url: code })}>
              Open
            </Button>
          ) : undefined
        }
      />
    )
  }
}

function nothingFlash() {
  return <IslandFlash tone="warning" icon={<ScanText size={20} strokeWidth={1.75} />} title="No text there" caption="Try a larger region, or zoom in first" />
}

async function grab(ctx: PluginContext) {
  await new Promise((resolve) => setTimeout(resolve, AFTER_LAUNCHER_MS))
  let grabbed: GrabbedText | null
  try {
    grabbed = await ctx.call('screen.grabText', {})
  } catch {
    return
  }
  if (!grabbed) return
  const code = grabbed.codes[0]
  const text = grabbed.text.trim()
  if (code) {
    await ctx.call('clipboard.writeText', { text: code })
    ctx.activity.flash({ priority: 'alert', key: 'grab', view: codeFlash(ctx, code), durationMs: 6000 })
  } else if (text) {
    await ctx.call('clipboard.writeText', { text })
    ctx.activity.flash({ priority: 'alert', key: 'grab', view: copiedFlash(text), durationMs: 3000 })
  } else {
    ctx.activity.flash({ priority: 'alert', key: 'grab', view: nothingFlash, durationMs: 3000 })
  }
}

const WORDS = /^(grab|ocr|scan|copy text|text from|qr)/i

export default definePlugin({
  search: {
    title: 'Grab Text',
    icon: ScanText,
    keywords: ['grab', 'ocr'],
    root: { limit: 1 },
    provide: (query, { ctx, root }) =>
      root && !WORDS.test(query.trim())
        ? []
        : [
            {
              id: 'grab',
              title: 'Grab text from the screen',
              subtitle: 'Drag over any text or QR code to copy it',
              icon: ScanText,
              actions: [{ title: 'Grab', run: () => void grab(ctx) }],
            },
          ],
  },
})
