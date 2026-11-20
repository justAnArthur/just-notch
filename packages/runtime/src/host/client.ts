import type { HostEvent, HostRequest, Method, Methods } from '@just-notch/bridge-schema'

export interface HostHandler {
  postMessage(request: HostRequest): Promise<unknown>
}

declare global {
  interface Window {
    webkit?: { messageHandlers: { host: HostHandler } }
    __notch?: { dispatch(events: HostEvent[]): void; idle?: () => boolean }
  }
}

/** Calls the host as `plugin` (`runtime` for the runtime itself). */
export function call<M extends Method>(plugin: string, method: M, params: Methods[M]['params']): Promise<Methods[M]['result']> {
  const host = window.webkit?.messageHandlers.host
  if (!host) return Promise.reject(new Error('no host: install the mock before calling'))
  return host.postMessage({ plugin, method, params } as HostRequest) as Promise<Methods[M]['result']>
}

export function log(level: Methods['host.log']['params']['level'], message: string) {
  console[level](message)
  void call('runtime', 'host.log', { level, message }).catch(() => {})
}
