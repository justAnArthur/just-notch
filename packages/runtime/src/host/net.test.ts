import { describe, expect, test, vi } from 'vitest'
import { base64ToBytes, bytesToBase64, performNetFetch, toResponse } from './net'

type Reply = { status?: number; headers?: Record<string, string>; body?: BodyInit | null; url?: string }

function fake(replies: Record<string, Reply>) {
  const seen: { url: string; init: RequestInit }[] = []
  const impl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    seen.push({ url, init })
    const reply = replies[url] ?? { status: 404 }
    const response = new Response(reply.body ?? null, { status: reply.status ?? 200, headers: reply.headers })
    if (reply.url) Object.defineProperty(response, 'url', { value: reply.url })
    return response
  })
  return { fetch: impl as unknown as typeof fetch, seen }
}

describe('performNetFetch', () => {
  test('text and headers, with dropped request headers and JSON bodies', async () => {
    const { fetch, seen } = fake({ 'https://api.github.com/user': { headers: { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': '9' }, body: '{"login":"me"}' } })
    const result = await performNetFetch(
      { url: 'https://api.github.com/user', method: 'POST', json: { a: 1 }, headers: { Cookie: 'x', Host: 'evil', Authorization: 'Bearer t' } },
      ['api.github.com'],
      { fetch },
    )
    expect(result).toEqual({
      status: 200,
      url: 'https://api.github.com/user',
      headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '9' },
      body: '{"login":"me"}',
      encoding: 'text',
    })
    const headers = seen[0].init.headers as Headers
    expect([...headers.keys()].sort()).toEqual(['authorization', 'content-type'])
    expect(seen[0].init.body).toBe('{"a":1}')
    expect(seen[0].init.credentials).toBe('omit')
  })

  test('binary bodies come back as base64', async () => {
    const { fetch } = fake({ 'https://a.test/x.png': { headers: { 'content-type': 'image/png' }, body: new Uint8Array([0, 1, 2]) } })
    const result = await performNetFetch({ url: 'https://a.test/x.png' }, ['a.test'], { fetch })
    expect(result.encoding).toBe('base64')
    expect(result.body).toBe('AAEC')
  })

  test('refuses hosts, schemes and mixed bodies', async () => {
    const { fetch } = fake({})
    await expect(performNetFetch({ url: 'https://evil.test/' }, ['a.test'], { fetch })).rejects.toThrow('not in the plugin')
    await expect(performNetFetch({ url: 'http://a.test/' }, ['a.test'], { fetch })).rejects.toThrow('needs https')
    await expect(performNetFetch({ url: 'https://a.test/', body: 'x', json: 1 }, ['a.test'], { fetch })).rejects.toThrow('not both')
    await expect(performNetFetch({ url: 'nope' }, ['a.test'], { fetch })).rejects.toThrow('absolute url')
    expect(await performNetFetch({ url: 'http://localhost:9/' }, ['localhost'], { fetch }).then((r) => r.status)).toBe(404)
  })

  test('manual redirects re-check every hop and drop Authorization off the origin', async () => {
    const { fetch, seen } = fake({
      'https://a.test/start': { status: 302, headers: { location: 'https://b.test/end' } },
      'https://b.test/end': { headers: { 'content-type': 'text/plain' }, body: 'done' },
      'https://a.test/escape': { status: 302, headers: { location: 'https://evil.test/' } },
    })
    const result = await performNetFetch({ url: 'https://a.test/start', headers: { Authorization: 'Bearer t' } }, ['a.test', 'b.test'], { fetch, manualRedirects: true })
    expect(result).toMatchObject({ url: 'https://b.test/end', body: 'done' })
    expect((seen[1].init.headers as Headers).has('authorization')).toBe(false)
    await expect(performNetFetch({ url: 'https://a.test/escape' }, ['a.test'], { fetch, manualRedirects: true })).rejects.toThrow('redirect refused')
    expect(seen.some((s) => s.url.startsWith('https://evil.test'))).toBe(false)
  })

  test('a browser checks the final URL', async () => {
    const { fetch } = fake({ 'https://a.test/x': { body: 'x', url: 'https://evil.test/x' } })
    await expect(performNetFetch({ url: 'https://a.test/x' }, ['a.test'], { fetch })).rejects.toThrow('redirect refused')
  })

  test('over 5 MiB rejects, declared or streamed', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    const { fetch } = fake({
      'https://a.test/declared': { headers: { 'content-length': String(big.length) }, body: 'x' },
      'https://a.test/streamed': { body: big },
    })
    await expect(performNetFetch({ url: 'https://a.test/declared' }, ['a.test'], { fetch })).rejects.toThrow('larger than 5 MiB')
    await expect(performNetFetch({ url: 'https://a.test/streamed' }, ['a.test'], { fetch })).rejects.toThrow('larger than 5 MiB')
  })
})

describe('toResponse', () => {
  test('a real Response: status, headers, url, decoded base64', async () => {
    const response = toResponse({ status: 201, url: 'https://a.test/x', headers: { 'content-type': 'image/png' }, body: 'AAEC', encoding: 'base64' })
    expect(response.status).toBe(201)
    expect(response.ok).toBe(true)
    expect(response.url).toBe('https://a.test/x')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2])
  })

  test('null bodies for 204, 205 and 304', () => {
    for (const status of [204, 205, 304]) expect(toResponse({ status, url: 'https://a.test/', headers: {}, body: '', encoding: 'text' }).body).toBeNull()
  })

  test('base64 round-trips large buffers', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})
