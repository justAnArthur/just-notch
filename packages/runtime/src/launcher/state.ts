/**
 * Whether the launcher is on screen. The host's hover zone includes every hit region, the launcher's too,
 * so without this the pointer resting on the search bar would open the island behind it.
 */
let open = false

export const isLauncherOpen = () => open
export const setLauncherOpen = (next: boolean) => {
  open = next
}

const tryListeners = new Set<() => void>()

/** Settings' Try it: opens the launcher from the page, as its hotkey would. */
export const tryLauncher = () => {
  for (const listener of [...tryListeners]) listener()
}
export const onTryLauncher = (listener: () => void) => {
  tryListeners.add(listener)
  return () => void tryListeners.delete(listener)
}
