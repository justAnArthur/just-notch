import { Button, ContextMenu, ContextMenuContent, ContextMenuItem, FluidHover, spring } from '@justanarthur/modo-ui'
import { definePlugin, type PluginContext, usePlugin } from '@just-notch/sdk'
import { ArrowDownToLine, Check, File, Files, Send, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ComponentType, type HTMLAttributes, useEffect, useState, useSyncExternalStore } from 'react'

// modo-ui 0.6 attaches `ContextMenu.Trigger` (Base UI's) at runtime but leaves it out of the types.
const MenuTrigger = (ContextMenu as unknown as { Trigger: ComponentType<HTMLAttributes<HTMLDivElement>> }).Trigger

const KEY = 'paths'
const THUMB_PX = 112
const DRAG_FLASH_MS = 60_000

interface Drag {
  phase: 'dragging' | 'added'
  count: number
}

function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => void listeners.delete(l)
  }
  return {
    get: () => value,
    subscribe,
    set(next: T) {
      value = next
      for (const l of [...listeners]) l()
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  }
}

const shelf = store<string[]>([])
const drag = store<Drag>({ phase: 'dragging', count: 0 })

const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path
const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`

const thumbs = new Map<string, Promise<string | undefined>>()

function useThumbnail(path: string) {
  const { call } = usePlugin()
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let live = true
    if (!thumbs.has(path))
      thumbs.set(
        path,
        call('files.thumbnail', { path, size: THUMB_PX }).then(
          (r) => r.url,
          () => undefined,
        ),
      )
    void thumbs.get(path)?.then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [call, path])
  return url
}

// Menus portal out of the island; this keeps them in its dark scope.
function menuContainer() {
  const existing = document.getElementById('shelf-menus')
  if (existing) return existing
  const el = document.createElement('div')
  el.id = 'shelf-menus'
  el.className = 'dark island'
  document.body.append(el)
  return el
}

function Tile({ path, index, persist }: { path: string; index: number; persist: (paths: string[]) => void }) {
  const { call } = usePlugin()
  const url = useThumbnail(path)
  const name = baseName(path)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: spring.moderate.exit }}
      transition={spring.moderate}
    >
      <ContextMenu size="compact">
        <MenuTrigger>
          <FluidHover.Item
            index={index}
            title={path}
            className="h-auto w-20 flex-col items-center justify-start gap-1.5 p-1.5"
            onPointerDown={(e) => e.button === 0 && void call('files.beginDrag', { paths: [path] })}
            onDoubleClick={() => void call('files.open', { path })}
          >
            {url ? (
              <img alt="" src={url} draggable={false} className="size-14 rounded-lg object-cover" />
            ) : (
              <span className="flex size-14 items-center justify-center rounded-lg bg-surface-3 text-muted-foreground">
                <File size={20} strokeWidth={1.5} />
              </span>
            )}
            <span className="w-full truncate text-center text-micro text-foreground">{name}</span>
          </FluidHover.Item>
        </MenuTrigger>
        <ContextMenuContent container={menuContainer()}>
          <ContextMenuItem index={0} label="Open" onSelect={() => void call('files.open', { path })} />
          <ContextMenuItem index={1} label="Show in Finder" onSelect={() => void call('files.reveal', { path })} />
          <ContextMenuItem index={2} label="Remove from shelf" onSelect={() => persist(shelf.get().filter((p) => p !== path))} />
        </ContextMenuContent>
      </ContextMenu>
    </motion.div>
  )
}

function usePersist() {
  const { storage } = usePlugin()
  return (paths: string[]) => {
    shelf.set(paths)
    void storage.set(KEY, paths)
  }
}

function Shelf() {
  const paths = shelf.use()
  const persist = usePersist()
  const { call } = usePlugin()
  if (paths.length === 0) return <Empty />
  return (
    <div className="flex size-full flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <span className="text-caption text-muted-foreground tabular-nums">{files(paths.length)}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="compact" leadingIcon={Send} onClick={() => void call('files.airdrop', { paths })}>
            AirDrop
          </Button>
          <Button variant="ghost" size="compact" leadingIcon={Trash2} onClick={() => persist([])}>
            Clear
          </Button>
        </div>
      </div>
      <FluidHover axis="x" className="-mx-3 flex min-h-0 flex-1 items-start overflow-x-auto overflow-y-hidden">
        <AnimatePresence initial={false}>
          {paths.map((path, i) => (
            <Tile key={path} path={path} index={i} persist={persist} />
          ))}
        </AnimatePresence>
      </FluidHover>
    </div>
  )
}

function Empty() {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-surface-3 text-muted-foreground">
        <Files size={16} strokeWidth={1.5} />
      </div>
      <div className="flex flex-col">
        <span className="text-body weight-medium text-foreground">Shelf is empty</span>
        <span className="text-caption text-muted-foreground">Drag files onto the notch to keep them here.</span>
      </div>
    </div>
  )
}

function DropFlash() {
  const { phase, count } = drag.use()
  const total = shelf.use().length
  const added = phase === 'added'
  return (
    <div
      className={`flex h-10 items-center gap-3 rounded-xl border px-3 transition-[border-color] duration-moderate ${added ? 'border-transparent' : 'border-dashed border-brand'}`}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={phase}
          className={`flex shrink-0 ${added ? 'text-status-success' : 'text-brand'}`}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6, transition: spring.fast.exit }}
          transition={spring.moderate}
        >
          {added ? <Check size={16} strokeWidth={2} /> : <ArrowDownToLine size={16} strokeWidth={1.5} />}
        </motion.span>
      </AnimatePresence>
      <span className="min-w-0 flex-1 truncate text-body weight-semibold text-foreground">{added ? 'Added to shelf' : 'Drop to shelf'}</span>
      <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{added ? `${total} on shelf` : files(count)}</span>
    </div>
  )
}

function Count() {
  return <span className="text-caption weight-medium text-foreground tabular-nums">{shelf.use().length}</span>
}

function activate(ctx: PluginContext) {
  let cancel: ReturnType<typeof setTimeout> | undefined
  const flash = (durationMs: number) => ctx.activity.flash({ priority: 'alert', key: 'drop', view: DropFlash, durationMs })

  const sync = () => {
    if (!shown) return ctx.activity.hide()
    ctx.activity.show({
      priority: 'ambient',
      compact: { leading: () => <Files size={16} strokeWidth={1.5} className="text-foreground" />, trailing: Count },
      expanded: Shelf,
    })
  }

  let shown = false
  const stopShelf = shelf.subscribe(() => {
    const has = shelf.get().length > 0
    if (has === shown) return
    shown = has
    sync()
  })
  let targetOpen = false

  void ctx.storage.get<string[]>(KEY).then((paths) => paths?.length && shelf.set(paths))

  const stopDragging = ctx.on('files.dragging', ({ active, count }) => {
    clearTimeout(cancel)
    if (active) {
      drag.set({ phase: 'dragging', count })
      if (!targetOpen) flash(DRAG_FLASH_MS)
      targetOpen = true
      return
    }
    // A drop arrives right after the drag ends; only a drag that ends without one closes the target.
    cancel = setTimeout(() => {
      targetOpen = false
      flash(1)
    }, 150)
  })

  const stopDropped = ctx.on('files.dropped', ({ paths }) => {
    clearTimeout(cancel)
    targetOpen = false
    const next = [...shelf.get(), ...paths.filter((p) => !shelf.get().includes(p))]
    shelf.set(next)
    void ctx.storage.set(KEY, next)
    drag.set({ phase: 'added', count: paths.length })
    flash(1400)
  })

  return () => {
    clearTimeout(cancel)
    stopShelf()
    stopDragging()
    stopDropped()
    ctx.activity.hide()
  }
}

export default definePlugin({
  activate,
  widget: { title: 'Shelf', icon: () => <Files size={14} strokeWidth={1.5} />, view: Shelf },
})
