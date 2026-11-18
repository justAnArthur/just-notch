import {
  hostAllowed,
  NET_DROPPED_HEADERS,
  NET_MAX_RESPONSE_BYTES,
  type NetRequest,
  type NetResponse,
  netHostKey,
  netResponseType,
  netSchemeAllowed,
  netTimeout,
} from '@just-notch/bridge-schema'

/*
 * `net.fetch` outside the Swift host: the mock host's browser fallback and the dev server's
 * `/__notch/net` proxy (Node). Same rules as apps/macos HTTPProxy: allowed hosts on every hop,
 * `Authorization` dropped off the original host, 5 MiB cap.
 */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
const REDIRECTS = [301, 302, 303, 307, 308]
const MAX_HOPS = 20

function problem(url: URL, allowed: readonly string[]): string | undefined {
  if (!netSchemeAllowed(url)) return `net.fetch needs https (http only for local hosts): ${url.href}`
  if (!hostAllowed(allowed, url)) return `net.fetch: ${netHostKey(url)} is not in the plugin's hosts; ask with net.requestHost`
}

export interface NetFetchOptions {
  fetch?: typeof fetch
  /** Follow redirects here, re-checking each hop (Node). A browser can't see them: it checks the final URL. */
  manualRedirects?: boolean
}

export async function performNetFetch(request: NetRequest, allowed: readonly string[], options: NetFetchOptions = {}): Promise<NetResponse> {
  const fetchImpl = options.fetch ?? fetch
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    throw new Error('net.fetch needs an absolute url')
  }
  const refused = problem(url, allowed)
  if (refused) throw new Error(refused)

  let method = (request.method ?? 'GET').toUpperCase()
  if (!METHODS.includes(method)) throw new Error(`net.fetch: unsupported method ${method}`)
  if (request.body !== undefined && request.json !== undefined) throw new Error('net.fetch takes either body (a string) or json, not both')

  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers ?? {})) if (!NET_DROPPED_HEADERS.includes(name.toLowerCase())) headers.set(name, value)
  let body = request.json !== undefined ? JSON.stringify(request.json) : request.body
  if (request.json !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')

  const origin = url.host
  const signal = AbortSignal.timeout(netTimeout(request.timeoutMs))
  let response: Response
  for (let hop = 0; ; hop++) {
    if (hop > MAX_HOPS) throw new Error('net.fetch: too many redirects')
    response = await fetchImpl(url, { method, headers, body, signal, credentials: 'omit', redirect: options.manualRedirects ? 'manual' : 'follow' })
    const location = response.headers.get('location')
    if (!options.manualRedirects) {
      const final = response.url ? new URL(response.url) : url
      const blocked = problem(final, allowed)
      if (blocked) throw new Error(`redirect refused: ${blocked}`)
      url = final
      break
    }
    if (!REDIRECTS.includes(response.status) || !location) break
    await response.body?.cancel()
    const next = new URL(location, url)
    const blocked = problem(next, allowed)
    if (blocked) throw new Error(`redirect refused: ${blocked}`)
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET'
      body = undefined
      headers.delete('content-type')
    }
    if (next.host !== origin) headers.delete('authorization')
    url = next
  }

  const bytes = await readCapped(response)
  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, name) => (responseHeaders[name.toLowerCase()] = value))
  const encoding = request.responseType ?? netResponseType(response.headers.get('content-type'))
  return {
    status: response.status,
    url: url.href,
    headers: responseHeaders,
    body: encoding === 'text' ? new TextDecoder().decode(bytes) : bytesToBase64(bytes),
    encoding,
  }
}

const TOO_LARGE = 'net.fetch: the response is larger than 5 MiB'

async function readCapped(response: Response): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length') ?? 0) > NET_MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error(TOO_LARGE)
  }
  if (!response.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > NET_MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error(TOO_LARGE)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

const NULL_BODY = [204, 205, 304]

/** A bridge `NetResponse` as the `Response` `ctx.fetch` resolves with. */
export function toResponse(result: NetResponse): Response {
  const body = NULL_BODY.includes(result.status) ? null : result.encoding === 'base64' ? base64ToBytes(result.body) : result.body
  const response = new Response(body, { status: result.status, headers: result.headers })
  Object.defineProperty(response, 'url', { value: result.url })
  return response
}
