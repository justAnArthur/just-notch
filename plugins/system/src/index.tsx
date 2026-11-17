import { type StatsHero, type StatsSample, SystemStats } from '@justanarthur/modo-ui-notch'
import { List } from '@justanarthur/modo-ui'
import { definePlugin, type PluginContext, SelectRow, signal, type StatsState, SwitchRow, useStorage, useTopic } from '@just-notch/sdk'
import { Activity } from 'lucide-react'
import { useEffect, useState } from 'react'

const HERO = 'hero'
const WINGS = 'wings'
/** About two minutes of trend at the host's 2 s sampling. */
const KEEP = 60

/** The host judges pressure in three steps; the kit reads 0–1. Normal leaves the share in use to stand in. */
const PRESSURE = { normal: undefined, warning: 0.8, critical: 0.95 } as const

function toSample(s: StatsState): StatsSample {
  return {
    cpu: s.cpu,
    memoryUsed: s.memoryUsed,
    memoryTotal: s.memoryTotal,
    memoryPressure: PRESSURE[s.memoryPressure],
    netIn: s.netInBps,
    netOut: s.netOutBps,
  }
}

/** The latest reading while the wings show the load. */
const latest = signal<StatsSample | undefined>(undefined)

function Widget() {
  const stats = useTopic('stats')
  const power = useTopic('power')
  const processes = useTopic('processes')
  const [hero] = useStorage<StatsHero>(HERO, 'cpu')
  const [samples, setSamples] = useState<StatsSample[]>([])

  useEffect(() => {
    if (stats) setSamples((all) => [...all.slice(1 - KEEP), toSample(stats)])
  }, [stats])

  return (
    <SystemStats
      samples={samples}
      hero={hero}
      battery={power?.hasBattery ? { level: power.percent, charging: power.charging, minutesLeft: power.minutesRemaining } : undefined}
      disk={stats && { free: stats.diskFree, total: stats.diskTotal }}
      uptime={stats?.uptimeS}
      processes={processes?.map((p) => ({ id: String(p.pid), name: p.name, cpu: p.cpu, memory: p.memory }))}
    />
  )
}

function Trailing() {
  return <SystemStats.Trailing sample={latest.use()} />
}

function Minimal() {
  return <SystemStats.Minimal sample={latest.use()} />
}

function Settings() {
  const [hero, setHero] = useStorage<StatsHero>(HERO, 'cpu')
  const [wings, setWings] = useStorage(WINGS, false)
  return (
    <List>
      <List.Section title="Widget">
        <SelectRow
          label="Hero"
          description="The figure set large; the other shows among the facts under it."
          options={[
            { value: 'cpu', label: 'CPU load' },
            { value: 'memory', label: 'Memory pressure' },
          ]}
          value={hero}
          onValueChange={setHero}
        />
      </List.Section>
      <List.Section title="Wings">
        <SwitchRow
          label="Show CPU load beside the notch"
          description="Keeps sampling while it shows; otherwise only while the widget is open."
          checked={wings}
          onCheckedChange={setWings}
        />
      </List.Section>
    </List>
  )
}

/** With the wings on, an ambient activity shows the CPU load and keeps `stats` subscribed. */
function activate(ctx: PluginContext) {
  let stopTopic: (() => void) | undefined

  const wings = (on: boolean | undefined) => {
    if (!!on === !!stopTopic) return
    if (stopTopic) {
      stopTopic()
      stopTopic = undefined
      latest.set(undefined)
      return ctx.activity.hide()
    }
    stopTopic = ctx.subscribe('stats', (s) => latest.set(toSample(s)))
    ctx.activity.show({ priority: 'ambient', compact: { leading: SystemStats.Leading, trailing: Trailing }, minimal: Minimal, expanded: Widget })
  }

  const stop = ctx.storage.subscribe<boolean>(WINGS, wings)
  void ctx.storage.get<boolean>(WINGS).then(wings)

  return () => {
    stop()
    wings(false)
  }
}

export default definePlugin({
  activate,
  widget: { title: 'System', icon: Activity, view: Widget },
  settings: Settings,
})
