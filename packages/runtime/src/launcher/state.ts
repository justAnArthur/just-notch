/**
 * Whether the launcher is on screen. The host's hover zone includes every hit region, the launcher's too,
 * so without this the pointer resting on the search bar would open the island behind it.
 */
let open = false

export const isLauncherOpen = () => open
export const setLauncherOpen = (next: boolean) => {
  open = next
}
