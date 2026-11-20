import type { Topic, Topics } from '@just-notch/bridge-schema'
import type { Unsubscribe } from '@just-notch/sdk'
import { on } from './bus'
import { call, log } from './client'

interface Entry {
  value?: unknown
  has: boolean
  subscribers: Set<(value: never) => void>
}

const entries = new Map<Topic, Entry>()

/** Topics whose schema type admits `null`; typed against the schema, so a new topic has to be classified. */
const NULLABLE: { [T in Topic]: null extends Topics[T] ? true : false } = {
  media: true,
  power: false,
  audio: false,
  display: false,
  calendar: false,
  bluetooth: false,
  stats: false,
  processes: false,
  weather: false,
  clipboard: false,
  recentFiles: false,
  frontApp: true,
}

/** The host answers a subscription with `null` until its first sample; plugins wait for a real value instead. */
const deliverable = (topic: Topic, value: unknown) => value != null || NULLABLE[topic]

function publish(entry: Entry, value: unknown) {
  entry.value = value
  entry.has = true
  for (const cb of [...entry.subscribers]) (cb as (value: unknown) => void)(value)
}

on('topic', ({ topic, value }) => {
  const entry = entries.get(topic)
  if (entry && deliverable(topic, value)) publish(entry, value)
})

/**
 * One host subscription per topic, fanned out locally: the first subscriber
 * subscribes, the last one leaving unsubscribes. `cb` gets the current value
 * as soon as there is one, then every change.
 */
export function subscribeTopic<T extends Topic>(topic: T, cb: (value: Topics[T]) => void): Unsubscribe {
  let entry = entries.get(topic)
  if (!entry) {
    const created: Entry = { has: false, subscribers: new Set() }
    entries.set(topic, created)
    call('runtime', 'subscribe', { topic })
      .then((value) => {
        if (entries.get(topic) === created && !created.has && deliverable(topic, value)) publish(created, value)
      })
      .catch((error) => log('error', `subscribe ${topic}: ${error}`))
    entry = created
  }
  const current = entry
  current.subscribers.add(cb)
  if (current.has) cb(current.value as Topics[T])

  let done = false
  return () => {
    if (done) return
    done = true
    current.subscribers.delete(cb)
    if (current.subscribers.size > 0 || entries.get(topic) !== current) return
    entries.delete(topic)
    void call('runtime', 'unsubscribe', { topic }).catch(() => {})
  }
}
