import { Switch, SwitchGroup } from '@justanarthur/modo-ui'
import { definePlugin, type PluginContext, type StatsState, usePlugin, useStorage } from '@just-notch/sdk'
import { Activity, ArrowDown, ArrowUp, Cpu, type LucideIcon, MemoryStick, Network } from 'lucide-react'
import { type ReactNode, useEffect, useReducer } from 'react'

const HISTORY = 30

/** The last samples, kept only while something on screen subscribes, so the host samples only then. */
let samples: StatsState[] = []

function useStats() {
  const ctx = usePlugin()
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(
    () =>
      ctx.subscribe('stats', (value) => {
        // Every subscriber gets the same object, so a sample is kept once however many views watch.
        if (samples.at(-1) !== value) samples = [...samples, value].slice(-HISTORY)
        rerender()
      }),
    [ctx],
  )
  return samples
}

const percent = (v: number) => `${Math.round(v * 100)}%`
const gigabytes = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

function rate(bps: number) {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`
  if (bps >= 1e3) return `${Math.round(bps / 1e3)} KB/s`
  return `${Math.round(bps)} B/s`
}

function points(values: number[], max: number) {
  const step = 100 / (HISTORY - 1)
  const offset = (HISTORY - values.length) * step
  return values.map((v, i) => `${(offset + i * step).toFixed(2)},${(30 - (v / max) * 28).toFixed(2)}`).join(' ')
}

/** Lines over a fixed 30-sample window, newest at the right edge; `max` scales every series of one tile alike. */
function Sparkline({ series, max }: { series: { values: number[]; className: string }[]; max: number }) {
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-10 w-full overflow-visible" aria-hidden>
      {series.map(({ values, className }, i) => (
        <polyline
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed series
          key={i}
          points={points(values, max)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className={className}
        />
      ))}
    </svg>
  )
}

function Tile({ icon: Icon, label, value, children }: { icon: LucideIcon; label: string; value: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface-2 p-3">
      <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Icon size={14} strokeWidth={1.5} />
        {label}
      </span>
      <div className="flex min-w-0 items-baseline gap-2 text-subtitle weight-semibold text-foreground tabular-nums">{value}</div>
      <div className="mt-auto">{children}</div>
    </div>
  )
}

function System() {
  const history = useStats()
  const last = history.at(-1)
  if (!last) return null
  const netMax = Math.max(1, ...history.flatMap((s) => [s.netInBps, s.netOutBps]))
  return (
    <div className="grid size-full grid-cols-3 gap-3">
      <Tile icon={Cpu} label="CPU" value={percent(last.cpu)}>
        <Sparkline max={1} series={[{ values: history.map((s) => s.cpu), className: 'text-foreground' }]} />
      </Tile>
      <Tile
        icon={MemoryStick}
        label="Memory"
        value={
          <>
            {gigabytes(last.memoryUsed)}
            <span className="truncate text-caption weight-normal text-muted-foreground">of {gigabytes(last.memoryTotal)}</span>
          </>
        }
      >
        <Sparkline max={last.memoryTotal} series={[{ values: history.map((s) => s.memoryUsed), className: 'text-foreground' }]} />
      </Tile>
      <Tile
        icon={Network}
        label="Network"
        value={
          <>
            <span className="flex items-center gap-0.5">
              <ArrowDown size={12} strokeWidth={2} aria-label="In" />
              {rate(last.netInBps)}
            </span>
            <span className="flex min-w-0 items-center gap-0.5 truncate text-caption weight-normal text-muted-foreground">
              <ArrowUp size={12} strokeWidth={2} aria-label="Out" />
              {rate(last.netOutBps)}
            </span>
          </>
        }
      >
        <Sparkline
          max={netMax}
          series={[
            { values: history.map((s) => s.netOutBps), className: 'text-muted-foreground' },
            { values: history.map((s) => s.netInBps), className: 'text-foreground' },
          ]}
        />
      </Tile>
    </div>
  )
}

function CpuGlyph() {
  return <Cpu size={16} strokeWidth={1.5} className="text-muted-foreground" />
}

function CpuLoad() {
  const last = useStats().at(-1)
  if (!last) return null
  return <span className="text-caption weight-semibold text-foreground tabular-nums">{percent(last.cpu)}</span>
}

function Settings() {
  const [activity, setActivity] = useStorage('activity', false)
  return (
    <SwitchGroup>
      <Switch
        label="Show CPU load beside the notch"
        description="Keeps sampling while it shows; otherwise only while the System widget is open."
        checked={activity}
        onCheckedChange={setActivity}
      />
    </SwitchGroup>
  )
}

function activate(ctx: PluginContext) {
  let shown = false
  const sync = (on: boolean) => {
    if (on === shown) return
    shown = on
    if (on) ctx.activity.show({ priority: 'ambient', compact: { leading: CpuGlyph, trailing: CpuLoad } })
    else ctx.activity.hide()
  }
  void ctx.storage.get<boolean>('activity').then((on) => sync(on === true))
  const stop = ctx.storage.subscribe<boolean>('activity', (on) => sync(on === true))
  return () => {
    stop()
    ctx.activity.hide()
  }
}

export default definePlugin({
  activate,
  widget: { title: 'System', icon: Activity, view: System },
  settings: Settings,
})
