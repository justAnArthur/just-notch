import { Button } from '@justanarthur/modo-ui'
import { definePlugin } from '@just-notch/sdk'
import { Timer } from 'lucide-react'
import { useEffect, useState } from 'react'

const LENGTH_MS = 25 * 60_000
let endsAt = Date.now() + LENGTH_MS - 7 * 60_000

function useRemaining() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, endsAt - now)
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Ring() {
  const remaining = useRemaining()
  const r = 11
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 28 28" className="size-6 -rotate-90 text-status-warning" aria-label={clock(remaining)}>
      <circle cx="14" cy="14" r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2.5} />
      <circle cx="14" cy="14" r={r} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - remaining / LENGTH_MS)} />
    </svg>
  )
}

function Remaining() {
  return <span className="text-caption weight-medium text-status-warning tabular-nums">{clock(useRemaining())}</span>
}

function Expanded() {
  const remaining = useRemaining()
  return (
    <div className="flex size-full items-center justify-between">
      <span className="text-display text-status-warning tabular-nums">{clock(remaining)}</span>
      <Button variant="secondary" onClick={() => (endsAt = Date.now() + LENGTH_MS)}>
        Restart
      </Button>
    </div>
  )
}

export default definePlugin({
  activate(ctx) {
    ctx.activity.show({
      priority: 'timer',
      compact: { leading: () => <Timer size={16} strokeWidth={1.5} className="text-status-warning" />, trailing: Remaining },
      minimal: Ring,
      expanded: Expanded,
    })
  },
})
