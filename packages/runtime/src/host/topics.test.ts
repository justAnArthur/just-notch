import { describe, expect, test, vi } from 'vitest'

const answers: Record<string, unknown> = { stats: null, media: null }
vi.mock('./client', () => ({
  call: vi.fn(async (_plugin: string, method: string, params: { topic: string }) => (method === 'subscribe' ? answers[params.topic] : null)),
  log: vi.fn(),
}))

const { subscribeTopic } = await import('./topics')
const { dispatch } = await import('./bus')

const flush = () => new Promise((resolve) => setTimeout(resolve))

describe('topics', () => {
  test('a null snapshot of a non-nullable topic is held back until the first sample', async () => {
    const seen: unknown[] = []
    subscribeTopic('stats', (value) => seen.push(value))
    await flush()
    dispatch([{ type: 'topic', payload: { topic: 'stats', value: null as never } }])
    expect(seen).toEqual([])
    const sample = { cpu: 0.1, memoryUsed: 1, memoryTotal: 2, netInBps: 0, netOutBps: 0 }
    dispatch([{ type: 'topic', payload: { topic: 'stats', value: sample } }])
    expect(seen).toEqual([sample])
  })

  test('media is nullable: nothing playing is a value', async () => {
    const seen: unknown[] = []
    subscribeTopic('media', (value) => seen.push(value))
    await flush()
    expect(seen).toEqual([null])
  })
})
