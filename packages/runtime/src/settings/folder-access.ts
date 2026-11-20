import type { PermissionState } from '@just-notch/bridge-schema'

/**
 * The Downloads and Desktop folders have no check that doesn't prompt: the recent files scan asks the first time it
 * reads them. So the scan starts from the Permissions page or the tour only after an Allow… click, remembered here
 * (the island and the Welcome window share this origin's storage).
 */
const KEY = 'permissions.files.asked'

export function filesAsked(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function markFilesAsked() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // Without storage the page asks again next time it opens; the folders answer at once once allowed.
  }
}

/** The recent files watcher's answer as a permission state. */
export const filesState = (access: 'granted' | 'denied'): PermissionState => (access === 'granted' ? 'allowed' : 'off')
