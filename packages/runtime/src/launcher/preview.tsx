import { useEffect, useState } from 'react'
import { call } from '../host/client'
import { useIcons } from './apps'
import type { Row } from './rows'
import { Icon } from './results'

/** The pane's width beside the results, and the least height it needs. */
export const PREVIEW_W = 280
export const PREVIEW_MIN_H = 300
const THUMBNAIL = 480

/** Results show the pane in a scope whose rows have previews (Files, Clipboard), and in the root on ⌘Y. */
export const hasPreviews = (rows: Row[]) => rows.some((row) => row.preview)

/** Quick Look thumbnails, kept for the launcher's life so moving back and forth doesn't ask again. */
const thumbnails = new Map<string, string | null>()

function useThumbnail(path: string | undefined): string | undefined {
  const [, setVersion] = useState(0)
  useEffect(() => {
    if (!path || thumbnails.has(path)) return
    let live = true
    call('runtime', 'files.thumbnail', { path, size: THUMBNAIL }).then(
      ({ url }) => thumbnails.set(path, url),
      () => thumbnails.set(path, null),
    ).finally(() => live && setVersion((v) => v + 1))
    return () => {
      live = false
    }
  }, [path])
  return (path && thumbnails.get(path)) || undefined
}

/** The selected row, larger: its image or text, then its details. Rows without a preview show their icon and title. */
export function Preview({ row }: { row: Row | undefined }) {
  const preview = row?.preview
  const thumbnail = useThumbnail(preview?.thumbnail)
  const icons = useIcons(row?.icon && 'path' in row.icon ? [row.icon.path] : [])
  if (!row) return <aside aria-label="Preview" className="h-full border-l border-white/10" style={{ width: PREVIEW_W }} />

  const image = preview?.image ?? thumbnail
  return (
    <aside aria-label="Preview" className="flex h-full shrink-0 flex-col gap-3 overflow-hidden border-l border-white/10 p-4" style={{ width: PREVIEW_W }}>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {image ? (
          <img src={image} alt="" className="max-h-full max-w-full rounded-lg object-contain" draggable={false} />
        ) : preview?.text ? (
          <p className={`h-full w-full overflow-hidden text-ellipsis whitespace-pre-wrap break-words text-caption ${preview.mono ? 'font-mono' : ''}`}>{preview.text}</p>
        ) : (
          <Icon icon={row.icon} icons={icons} large />
        )}
      </div>
      <div className="shrink-0">
        <p className="truncate font-medium">{row.title}</p>
        {preview?.details?.length ? (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption">
            {preview.details.map((d) => (
              <div key={d.label} className="contents">
                <dt className="text-muted-foreground">{d.label}</dt>
                <dd className="truncate text-right">{d.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          row.subtitle && <p className="truncate text-caption text-muted-foreground">{row.subtitle}</p>
        )}
      </div>
    </aside>
  )
}
