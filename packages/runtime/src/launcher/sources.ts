import { useEffect, useState } from 'react'

/** A provider that answers later (files, a plugin scope), asked again whenever its key (query, scope) changes. */
export interface Source<T> {
  id: string
  key: string
  /** Waits this long after the last change before asking, so a network provider isn't asked on every key. */
  debounce: number
  /** Gives up after this long and shows an error with Retry. */
  timeout: number
  load(signal: AbortSignal): Promise<T>
}

/** A source's latest answer, with the key it answers: rows, or why there are none. */
export interface Answer<T> {
  key: string
  value?: T
  error?: 'failed' | 'timeout'
}

/** What a source shows now. */
export interface SourceView<T> {
  /** The latest rows, even for an older key while the fresh ones load, so its section stays put between keys. */
  value?: T
  error?: Answer<T>['error']
  /** Still waiting for the answer to the current key. */
  pending: boolean
}

/** What `answer` shows for a source asked with `key`. */
export function viewOf<T>(answer: Answer<T> | undefined, key: string): SourceView<T> {
  return { value: answer?.value, error: answer?.error, pending: answer?.key !== key }
}

class Timeout extends Error {}

/** Each source's answer, kept until a fresh one replaces it; sources no longer asked are dropped. */
export function useSources<T>(sources: Source<T>[]): { views: Record<string, SourceView<T>>; retry(): void } {
  const [answers, setAnswers] = useState<Record<string, Answer<T>>>({})
  const [attempt, setAttempt] = useState(0)
  const signature = sources.map((s) => `${s.id}\u0001${s.key}`).join('\u0002')

  useEffect(() => {
    const ids = new Set(sources.map((s) => s.id))
    setAnswers((all) => (Object.keys(all).every((id) => ids.has(id)) ? all : Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id)))))
    const stops = sources.map((source) => {
      let live = true
      const controller = new AbortController()
      const settle = (answer: Omit<Answer<T>, 'key'>) => live && setAnswers((all) => ({ ...all, [source.id]: { key: source.key, ...answer } }))
      const timer = setTimeout(async () => {
        let limit: ReturnType<typeof setTimeout> | undefined
        const late = new Promise<never>((_, reject) => {
          limit = setTimeout(() => reject(new Timeout()), source.timeout)
        })
        try {
          settle({ value: await Promise.race([source.load(controller.signal), late]) })
        } catch (error) {
          if (error instanceof Timeout) controller.abort()
          settle({ error: error instanceof Timeout ? 'timeout' : 'failed' })
        } finally {
          clearTimeout(limit)
        }
      }, source.debounce)
      return () => {
        live = false
        clearTimeout(timer)
        controller.abort()
      }
    })
    return () => {
      for (const stop of stops) stop()
    }
  }, [signature, attempt])

  return {
    views: Object.fromEntries(sources.map((s) => [s.id, viewOf(answers[s.id], s.key)])),
    retry: () => setAttempt((n) => n + 1),
  }
}

/** True once `on` has held for `ms`: the loading bar shows only for a wait you'd notice. */
export function useHeld(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!on) return setHeld(false)
    const timer = setTimeout(() => setHeld(true), ms)
    return () => clearTimeout(timer)
  }, [on, ms])
  return held
}
