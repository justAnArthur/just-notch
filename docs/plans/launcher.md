# Launcher: Spotlight in the notch

A launcher that drops out of the notch like a drop of water: a search bar with inline math, conversions, apps and files, plus scopes that plugins add. Clipboard history is the first scope. It covers what Spotlight does today, and the plugin API leaves room for Raycast-style extensions later.

The reference is macOS 26 Spotlight: one search pill, then round scope buttons (Apps, Files, Actions, Clipboard) that ⌘1–⌘4 switch to. The pill shows the active scope as a chip ("Clipboard ⌘4").

## Status (2026-11-19)

Built: the drop (a bead, a neck, a fall that eases into a squash, one rounded bar, then the buttons pinch off; a 140 ms fade to close), apps with frecency, inline maths and conversions (units, ECB currency, time zones, dates), file search, Actions (system actions and Shortcuts), a web fallback, the plugin `search` API with the Clipboard scope (↩ pastes into the app in front), and Settings › Launcher. The open island and the launcher row are 648 pt wide; the bar rests at 38% of the screen height. Plugin API 1.2.0.

Since 1.3.1: the ⌘K actions panel (every action of the selected row, filtered by typing, at the sheet's bottom right), and a preview pane beside the results (Quick Look thumbnails and details for files, the whole clip for Clipboard; always on in scopes with previews, ⌘Y in the root). Plugin API 1.3.0 adds `SearchItem.preview`.

Left for later: scope order in Settings, and plugin scopes for the GitHub and YouTrack library plugins.

## What exists already

| Piece | Where | State |
|---|---|---|
| Global hotkeys | `App/HotKeys.swift` (Carbon, no Accessibility permission), `shortcuts.register` (runtime only) | Works. Nothing registers a hotkey yet. |
| Panel that can take keys | `NotchPanel.focusable` → `canBecomeKey` | Never made key on its own: the user has to click into it. |
| Island shape and motion | `island/geometry.ts` `islandPath`, `island.tsx` motion values, an SVG goo filter for the split bubble | Good base for the drop. |
| Clipboard history | `ClipboardService.swift`, `plugins/clipboard`, the kit's `ClipboardHistory` block (search, keyboard selection) | Done. Becomes a scope. |
| App list | `InstalledApps.swift`, `apps.list` | Top-level folders only. Gated behind the `clipboard` permission. No launching. |
| File search | none | No `NSMetadataQuery` or `mdfind` anywhere. |
| Plugin model | `definePlugin({ activate, widget, settings })` | No way for a plugin to add search results. |

## Experience

### Opening: the drop

The island's own path does the drop. Its state is new: `launcher`. Times are from the hotkey press.

1. **Swell, 0–90 ms.** The notch's bottom edge sags into a bulge: `h` grows by 10–14 pt, the bottom corners round off and the width stays the same.
2. **Fall, 90–240 ms.** A second body, the drop, falls from the bulge. It starts round at about 40 pt and stretches tall as it falls. A neck joins it to the notch; the existing goo filter (blur plus alpha threshold) melts the two bodies together.
3. **Pinch, 240–330 ms.** The neck thins and snaps. The notch springs back to idle, with a small overshoot (bounce 0.3).
4. **Fall to centre, 240–420 ms.** Now free, the drop falls to where Spotlight sits: horizontally centred, about a third of the way down the screen. It falls with a slight ease-in, round again, with a faint trail as motion blur.
5. **Spread, 420–600 ms.** The drop lands and flattens into the pill: width 40 → 560, height 40 → 52, radius stays at height/2. A spring (`visualDuration` 0.35, bounce 0.2) gives the surface-tension wobble.
6. **Settle.** The caret appears once the pill holds still, and typing already works from step 2 (keys are buffered). The scope buttons pop out of the pill's right side one by one: 30 ms stagger, scale 0.6 → 1, same goo, so they bud off the pill like small droplets.

Results then pour down under the pill as one rounded sheet, using the same spring as the island's expanded state.

**Closing** runs it backwards, shortened to about 260 ms. The results retract, the buttons are absorbed, the pill shrinks to a drop, and the drop rises into the notch, which takes it in with a small bulge. After Return on a result, close first, then run it, so the target app comes forward over a clean screen.

**Reduce Motion** turns all of this into a 120 ms fade and scale.

**Where it's drawn (decided: centred, like Spotlight).**
- The pill rests where Spotlight's does: centred, with its top at about 30% of the screen height. The drop starts at the notch, or at the menu bar's centre on screens without one.
- The page draws the whole journey, so the drop, the goo and the shared plugin runtime stay in one web view. To fit it, the `NotchPanel` grows while the launcher is open: 760 pt wide, from the screen top down to the bottom of the results sheet. It goes back to 720×620 once closed.
- Hit regions keep the rest of the grown panel click-through. Clicking outside them closes the launcher.
- The panel's frame changes once, before the drop starts, and the page lays out against the new size, so no window resize happens during the animation.

### Keyboard

| Key | Does |
|---|---|
| hotkey (⌥Space by default, changeable; you'll use ⌘Space) | open; press again to close |
| type | search all scopes |
| ↑ ↓ | move through results |
| ↩ | the result's main action (open, copy, paste) |
| ⌘↩ | its second action (reveal in Finder, paste as plain text…) |
| ⌘K | every action for the result |
| ⌘1…⌘9 | switch to a scope (the round buttons); ⌘0 or Backspace in an empty field → all |
| Tab | complete the result into the field (an app name, a path) |
| ⌘C | copy the result (a math answer, a conversion, a clip) |
| Esc | leave the scope, then clear the field, then close |

Clicking outside closes the launcher. It also closes when another app becomes active.

### Root results, in order

1. **Inline answer**: math or a conversion, shown as one large card ("= 1 337", "12 USD = 11.04 EUR"). ↩ copies it.
2. **Top hit**: the best match across scopes, ranked by frecency.
3. **Applications**, up to 6.
4. **Plugin scopes**: each shows up to 3 under its own header (Clipboard and later others).
5. **Files**, up to 6, then "Show all in Files ⌘2".
6. **Fallbacks**: "Search the web for …" and "Search in Finder".

## Architecture

### Host (Swift)

- **`Launcher` controller** (`Window/Launcher.swift`)
  - Owns the hotkey: built in, a host feature rather than a plugin one.
  - Remembers the frontmost app, makes the panel key on the screen with the mouse (`makeKeyAndOrderFront`, web view as first responder) and sends the page `launcher.open`.
  - On close it hands focus back to the remembered app.
  - **Spike:** check that a non-activating panel takes text without `NSApp.activate`. That is how Spotlight-style panels avoid taking over the menu bar. If it can't, activate and then give focus back on close.
- **Apps**: `apps.list` grows into a launcher index.
  - Recursive scan with `NSMetadataQuery` on `kMDItemContentType == com.apple.application-bundle`. It finds apps in subfolders (Adobe, Setapp) and updates live.
  - Adds System Settings panes later.
  - New method `apps.launch {bundleId}` (`NSWorkspace.openApplication`) under a new permission `apps.launch`.
  - `apps.list` moves to a new `apps.read` permission; the clipboard plugin's manifest gains it.
- **Files**: `FileSearchService`.
  - `files.search {query, limit, kinds?}` runs `NSMetadataQuery` over `kMDItemDisplayName`, with the user's home and iCloud Drive as scopes. Results stream on the `fileSearch` topic as the query gathers; a new query cancels the last.
  - New permission `files.search`.
  - Opening, Quick Look and reveal reuse `files.*`.
- **Actions** (phase 5): `shortcuts list` and `shortcuts run` (the system CLI) for the Shortcuts app, plus a short system list: lock screen, sleep, empty Trash, toggle Dark Mode.
- **Hotkey preference**: `AppPreferences.launcherHotkey`, default `Alt+Space`. It can be changed in Settings › Launcher.
  - ⌘Space belongs to Spotlight. Carbon can't take it while Spotlight holds it.
  - Settings detects the clash (registration fails) and shows how to free it, with a button that opens Keyboard › Shortcuts › Spotlight in System Settings. Nothing changes system settings for the user.

Each new method goes into `bridge-schema` and `Schema.swift` together, gets a mock handler, and bumps `API_VERSION` 1.1 → 1.2.

### Runtime (TS)

- **The `launcher` island state** in `activity/reducer.ts`, with its own geometry in `geometry.ts`: the pill, scope buttons and results sheet as rects in the panel. Hit regions come from those rects. Opening collapses an expanded island first.
- **`launcher/`**
  - `query.ts` runs every provider for the query. Each provider has a 60 ms budget; slow ones (files) fill in later without the list jumping: rows only append under their own header.
  - `rank.ts`: fuzzy match (initials, word starts, gaps) times frecency. Frecency is kept per result id in storage, using the last 30 launches with a decay.
  - `actions.ts`: the keyboard model.
- **Engines**: pure TS, unit-tested, no eval.
  - `math/`: a Pratt parser.
    - `+ − × ÷ ^ %`, parentheses, implicit multiply (`2pi`).
    - `sqrt sin cos tan log ln abs round floor ceil`, `pi e`.
    - "15% of 80", "80 + 15%".
    - `0x` / `0b` and "in hex".
    - Locale decimal separators. An answer appears only when the input really is maths: at least one operator, or a function.
  - `convert/`:
    - Units: length, mass, volume, temperature, area, speed, data (KB/KiB), time.
    - Currency: ECB daily rates, fetched once a day with the host's own net and cached, so it works offline with the last rates. ECB covers 30 currencies; crypto is out.
    - Time zones: "5pm London in Tokyo", "time in NYC".
    - Dates: "in 3 weeks", "days until 24 dec".
    - Parses "12 usd to eur", "12usd in eur", "5'11 in cm", "100f".

### Plugin API: search scopes

A new optional `search` field in `definePlugin`. It is the extension point; built-in Apps and Files use it too.

```ts
definePlugin({
  search: {
    title: 'Clipboard',
    icon: Clipboard,
    keywords: ['clip', 'paste'],        // typing "clip " enters the scope
    root: { limit: 3 },                  // or false: only inside the scope
    provide(query, { signal }): SearchItem[] | AsyncIterable<SearchItem[]>,
    view?: ScopeView,                    // optional full view inside the scope (Clipboard uses its kit block)
  },
})

interface SearchItem {
  id: string
  title: string
  subtitle?: string
  icon?: Icon | { image: string }
  accessory?: string | { chip: string } | { shortcut: string }
  actions: SearchAction[]                // [0] is ↩, [1] is ⌘↩
  preview?: () => ReactNode              // the right-hand pane, as Spotlight shows it for files and clips
}

interface SearchAction {
  title: string
  icon?: Icon
  shortcut?: string
  run(): void | Promise<void>
}
```

- **Scope order** is user-set in Settings › Launcher. The first nine get ⌘1–⌘9; v1 defaults are Apps, Files, Actions, Clipboard, matching the screenshot.
- **Permissions:** providing a scope needs none. What a provider reads still goes through its own permissions.
- **Isolation:** providers run in the shared web view (the same trust as widgets). A provider that throws or misses its budget is dropped from that query and logged.
- **Library:** the catalog needs nothing new. `engines.notch >= 1.2` keeps older apps from installing plugins that need `search`.

### Kit (modo-ui-notch 0.6)

- **`Launcher` block**: the pill input with a scope chip, scope buttons, a grouped results list with headers, an inline answer card, a preview pane, an action panel (⌘K), and an empty state.
- **`DropReveal` motion helper**: the goo path from the opening animation, so the site and other surfaces can reuse it.
- The settings page gains a hotkey recorder (`ShortcutInput`).
- **`ClipboardHistory`** gains an embedded mode: no own search field, driven by the launcher's query and keys.

### Clipboard as the first plugin scope

`plugins/clipboard` adds a `search` scope.
- **Root:** the last 3 clips that match.
- **Inside the scope (⌘4):** the full `ClipboardHistory`, embedded, with pins.
- **↩ pastes into the app that was in front:** copy, close, then ⌘V through `CGEvent`. That needs Accessibility, so ask for it the first time and fall back to copy only.
- **⌘↩** copies without pasting. **⇧↩** pastes as plain text.

## Phases

Each phase ships as a release.

| # | Delivers | Main risk |
|---|---|---|
| 0 | **Spike**: hotkey → key panel → typing works, focus goes back on close. The drop animation prototyped in the dev runtime. | Text input in a non-activating panel. |
| 1 | Launcher shell, the drop, Apps (index, launch, frecency), Settings › Launcher (hotkey, enable). | Animation feel; keeping hit regions right. |
| 2 | Math and conversions, including currency. | Parsing that doesn't trigger on plain words. |
| 3 | File search (scope, previews, Quick Look). | Spotlight index latency and noise. Rank by recency and the user's folders. |
| 4 | `search` plugin API, scope buttons with ⌘1–⌘9, the Clipboard scope with paste-into-app, kit 0.6, API 1.2, CLI template `create --search`. | API shape. It's public once shipped, so review it before release. |
| 5 | Actions: Shortcuts and system commands. Web fallback. GitHub and YouTrack library plugins get scopes ("issues matching…"). | `shortcuts` CLI speed: cache the list. |

### Parallel work for phase 1 onward

- **Swift**: `Launcher.swift`, focus, apps index and launch, file search.
- **Engines**: math and convert in pure TS with tests. No UI dependency, so this can start first.
- **Kit**: the `Launcher` block and `DropReveal` in modo, through a PR as before.
- **Runtime**: state, geometry and the query pipeline. These wire the other three together, so they go last in each phase.

## Decisions (2026-11-19)

1. **Hotkey:** ⌥Space by default, so it doesn't clash with Spotlight, and changeable in Settings. The user will switch to ⌘Space after turning off Spotlight's shortcut.
2. **Currency:** ECB daily rates, fetched once a day and cached.
3. **Clipboard ↩:** pastes straight into the app that was in front. Accessibility is asked for the first time; until it's granted, ↩ copies only.
4. **Position:** centred like Spotlight. The drop falls from the notch to the centre and spreads into the pill with the goo effect.
