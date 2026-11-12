import type { EventName, Events, HostEvent } from '@just-notch/bridge-schema'
import type { Unsubscribe } from '@just-notch/sdk'

const listeners = new Map<EventName, Set<(payload: never) => void>>()

export function on<E extends EventName>(event: E, cb: (payload: Events[E]) => void): Unsubscribe {
  const set = listeners.get(event) ?? new Set()
  listeners.set(event, set)
  set.add(cb)
  return () => set.delete(cb)
}

export function dispatch(events: HostEvent[]) {
  for (const { type, payload } of events) {
    for (const cb of [...(listeners.get(type) ?? [])]) {
      try {
        ;(cb as (payload: unknown) => void)(payload)
      } catch (error) {
        console.error(`[notch] ${type} listener threw`, error)
      }
    }
  }
}

/** The host's only way in: `window.__notch.dispatch(events)`. */
export function installDispatch() {
  window.__notch = { dispatch }
}
