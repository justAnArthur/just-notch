import { List } from '@justanarthur/modo-ui'
import { IslandFlash, type IslandFlashTone } from '@justanarthur/modo-ui-notch'
import { definePlugin, type NetworkState, type PluginContext, SwitchRow, useStorage } from '@just-notch/sdk'
import { ShieldOff, Wifi, WifiHigh, WifiLow, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { evaluate, initialMemory, type Memory, type Notice } from './logic'

const OUTAGES = 'flashOutages'
const CALLS = 'flashCalls'

const KIND: Record<NonNullable<NetworkState['kind']>, string> = { wifi: 'Wi-Fi', ethernet: 'Ethernet', cellular: 'Your hotspot', other: 'Your network' }

function view(notice: Notice): { tone: IslandFlashTone; icon: ReactNode; title: string; caption: string; ms: number; key: string } {
  const icon = (Icon: typeof Wifi) => <Icon size={20} strokeWidth={1.75} />
  switch (notice.kind) {
    case 'offline':
      return { tone: 'error', icon: icon(WifiOff), title: 'You’re offline', caption: notice.was ? `${KIND[notice.was]} dropped` : 'No connection', ms: 4000, key: 'outage' }
    case 'online':
      return { tone: 'success', icon: icon(Wifi), title: 'Back online', caption: `After ${Math.round(notice.offlineFor / 1000)} s`, ms: 2500, key: 'outage' }
    case 'vpnLost':
      return { tone: 'warning', icon: icon(ShieldOff), title: 'VPN disconnected', caption: 'Traffic now goes over your normal connection', ms: 5000, key: 'vpn' }
    case 'slow':
      return { tone: 'warning', icon: icon(WifiLow), title: 'Your connection is slow', caption: `${Math.round(notice.latencyMs)} ms to the internet: it’s on your side`, ms: 6000, key: 'call' }
    case 'dropping':
      return { tone: 'error', icon: icon(WifiOff), title: 'Your connection is dropping', caption: 'Others may not hear you: it’s on your side', ms: 6000, key: 'call' }
    case 'recovered':
      return { tone: 'success', icon: icon(WifiHigh), title: 'Connection is fine again', caption: 'If the call still stutters, it’s on their side', ms: 3000, key: 'call' }
  }
}

const isCallNotice = (n: Notice) => n.kind === 'slow' || n.kind === 'dropping' || n.kind === 'recovered'

function activate(ctx: PluginContext) {
  let before: NetworkState | undefined
  let memory: Memory = initialMemory
  return ctx.subscribe('network', (after) => {
    const result = evaluate(before, after, memory, Date.now())
    before = after
    memory = result.memory
    for (const notice of result.notices) {
      void ctx.storage.get<boolean>(isCallNotice(notice) ? CALLS : OUTAGES).then((on) => {
        if (on === false) return
        const v = view(notice)
        ctx.activity.flash({ priority: 'alert', key: v.key, durationMs: v.ms, view: () => <IslandFlash tone={v.tone} icon={v.icon} title={v.title} caption={v.caption} /> })
      })
    }
  })
}

function Settings() {
  const [outages, setOutages] = useStorage(OUTAGES, true)
  const [calls, setCalls] = useStorage(CALLS, true)
  return (
    <List>
      <List.Section title="Connection">
        <SwitchRow label="Offline and VPN" description="When the Mac goes offline (and back after a real outage), and when a VPN disconnects." checked={outages} onCheckedChange={setOutages} />
        <SwitchRow
          label="During calls"
          description="While an app uses the microphone, Just Notch checks every few seconds how quickly it reaches the internet, and says when your side is slow or dropping, and when it's fine again."
          checked={calls}
          onCheckedChange={setCalls}
        />
      </List.Section>
    </List>
  )
}

export default definePlugin({ activate, settings: Settings })
