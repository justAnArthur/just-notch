<a href="https://justanarthur.github.io/just-notch/"><img src=".github/banner.svg" alt="A Dynamic Island for your notch: a thin Swift host owns the window and the system services; plugins written in React draw everything you see." width="100%"></a>

# Just Notch

[![ci](https://github.com/justAnArthur/just-notch/actions/workflows/ci.yml/badge.svg)](https://github.com/justAnArthur/just-notch/actions/workflows/ci.yml)
[![license: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue)](LICENSE.md)

A modular Dynamic Island for the MacBook notch. A thin native Swift host owns the window and the system services; everything you see is React + [`@justanarthur/modo-ui`](https://github.com/justAnArthur/modo/tree/main/ui) in one transparent web view; plugins add the rest.

Eight default plugins, built on the `@justanarthur/modo-ui-notch` kit: Now Playing, Calendar, Weather, Clock (with Pomodoro), System, Clipboard, Recent files and Window Management. More, such as GitHub and YouTrack, install from the [library](library/README.md).

Press ⌥Space for the [launcher](#launcher): search drops out of the notch to find apps, files, actions and your clipboard, snap the window in front to halves, quarters, thirds or sixths, and answers sums, conversions and time zones inline.

**[Download for Mac →](https://github.com/justAnArthur/just-notch/releases/latest/download/JustNotch.zip)** · [Website](https://justanarthur.github.io/just-notch/)

![The Now Playing plugin in the open island: track, artist, scrubber and playback controls](.github/screenshot.png)

## Install

Download [`JustNotch.zip`](https://github.com/justAnArthur/just-notch/releases/latest/download/JustNotch.zip) (or a versioned `JustNotch-x.y.z.zip` from [Releases](../../releases)), unzip, move `JustNotch.app` to Applications. macOS 14+.

The app is signed with the project's own self-signed certificate, not Apple's Developer ID, and isn't notarized, so open it the first time with right-click → Open, or:

```bash
xattr -dr com.apple.quarantine /Applications/JustNotch.app
```

### Updates

The app updates itself with [Sparkle](https://sparkle-project.org): it checks once a day, and on demand from the menu bar icon's **Check for Updates…** or Settings › About. Updates are verified with an EdDSA signature, then installed and relaunched; no second right-click → Open.

Every release is signed with the same certificate, so macOS treats each update as the same app: Calendar, Location, Automation, folder and Bluetooth permissions and the plugins' Keychain items carry over. Releases up to 1.2.x were ad-hoc signed, which made every update a new app; coming from one of those, grant the permissions (and Keychain access) one last time.

## Launcher

Press ⌥Space and a drop falls from the notch and spreads into a search bar, centred on the screen like Spotlight's; it closes with a quick fade. Change the shortcut in Settings › Launcher. It can be ⌘Space once you turn off Show Spotlight search in System Settings › Keyboard › Keyboard Shortcuts › Spotlight; until then Settings › Launcher warns about the conflict and opens that page for you.

What it finds as you type:

- **Applications**, ranked by how often and how recently you open them.
- **Answers**, inline: maths, unit conversions, currencies (ECB rates), time zones (`time in tokyo`), dates and number bases.
- **Files**, from the Spotlight index.
- **Actions**: Sleep, Turn Off Display, Start Screen Saver, Empty Trash, Toggle Dark Mode, and your Shortcuts.
- **Plugin scopes**, such as Clipboard and Window Management: `right` offers Right Half, the right quarters and thirds; ↩ moves the window in front (Just Notch asks for Accessibility the first time).
- A web search when nothing else fits.

The round buttons beside the bar are scopes: Applications, Files, Actions, then the plugins' (Clipboard, Window Management). ⌘1, ⌘2, … enter them in order, and so does a keyword and a space: `app `, `file `, `action `, `clip `, `win `.

| Key | Does |
| --- | --- |
| ↑ ↓ | move through the results |
| ↩ | the result's main action (open, paste, copy) |
| ⌘↩ | its second action (show in Finder, copy) |
| ⇧↩ | its third action (copy path, paste as plain text) |
| ⌘K | every action of the result, filtered as you type |
| ⌘Y | the preview pane in the main search |
| Tab | complete the result into the field |
| Esc | clear the field, then leave the scope, then close |
| ⌫ in an empty field | leave the scope |

The preview pane beside the results shows a Quick Look thumbnail and the details of a file, or the whole clip (image, colour or text) in Clipboard. Scopes with previews always show it.

In the Clipboard scope, ↩ pastes the clip straight into the app in front, ⌘↩ copies it and ⇧↩ pastes it as plain text. Pasting needs the Accessibility permission; without it the clip is only copied. Image clips paste into Electron and Qt apps such as Telegram, Slack and Beeper too.

## How it works

The Swift host puts one transparent panel over the notch and loads the runtime into its web view. Plugins never touch the system: they ask the runtime, the runtime posts the request over the bridge, and the host checks it against the plugin's manifest before a service in `NotchServices` runs it. State comes back as topic events.

```mermaid
sequenceDiagram
  participant P as Plugin (React)
  participant R as Runtime (web view)
  participant B as Bridge (postMessage)
  participant H as Swift host
  participant S as NotchServices
  P->>R: ctx.subscribe("media")
  R->>B: { plugin, method: "subscribe", params }
  B->>H: host message handler
  H->>H: check the manifest's permissions
  H->>S: start the media service
  S-->>H: now playing changed
  H-->>R: window.__notch.dispatch(events)
  R-->>P: topic update, the island re-renders
  P->>R: ctx.call("media.command", playPause)
  R->>B: { plugin, method: "media.command" }
  B->>H: host message handler
  H->>S: play / pause
```

## Develop

```bash
bun install
bun run build                       # runtime + plugins
cd apps/macos && xcodegen && xcodebuild -scheme JustNotch -configuration Debug -derivedDataPath build build
```

Live reload: `bun run dev` in `packages/runtime`, then launch the app with `NOTCH_DEV_URL=http://localhost:5174`. A browser at that URL runs the whole island against a mock host.

Write a plugin: `bun run notch create <id>`, then `bun run notch build --cwd plugins/<id>`. The scaffold asks for today's plugin API, `"engines": { "notch": "^1.4.0" }`. See [`packages/sdk`](packages/sdk/src/index.ts) and [`packages/cli`](packages/cli/README.md).

More plugins live in the [library](library/README.md): optional, released one by one, listed on the [website](https://justanarthur.github.io/just-notch/#library) and installed from Settings › Library after a native consent dialog. Start one with `bun run notch create <id> --library`; [`library/README.md`](library/README.md) covers the manifest, the release flow and the review checklist.

just-notch is `apps/notch` in the just-apps monorepo and builds only inside a just-apps checkout. Layout, conventions and release rules: [`AGENTS.md`](AGENTS.md).

### A launcher scope

A plugin adds a scope to the launcher with `search` on `definePlugin` (plugin API 1.2): a round button beside the bar, a keyword to enter it and, unless `root` is `false`, a few rows (3 by default) under its title in every search. `provide(query, { ctx, signal })` runs on every keystroke and returns `SearchItem`s, or a promise of them; the query is empty inside the scope before anything is typed, so show the newest, and `signal` aborts when a newer query replaces it. A result's first action runs on ↩, its second on ⌘↩, its third on ⇧↩, and ⌘K lists them all. Its `id` must stay the same across searches: the launcher remembers picks by it.

Plugin API 1.3 adds `preview`: what the preview pane shows for the selected result, an `image` (`data:` or `https:`) or some `text` (`mono` for a monospace face), then `details`, label and value lines. A plugin that sets it should ask for `"engines": { "notch": "^1.3.0" }`.

Plugin API 1.4 adds the `windows` permission: `windows.front` reads the front app's focused window and every screen's visible frame, `windows.setFrame` moves and resizes it. Both need Accessibility; [`plugins/windows`](plugins/windows/src/layouts.ts) builds its layouts on them.

```tsx
import { definePlugin, type PluginContext, type SearchItem } from '@just-notch/sdk'
import { Bookmark } from 'lucide-react'

const LINKS = [
  { id: 'notch', title: 'Just Notch', url: 'https://github.com/justAnArthur/just-notch' },
  { id: 'modo', title: 'modo-ui', url: 'https://github.com/justAnArthur/modo' },
]

function linkItem(link: (typeof LINKS)[number], ctx: PluginContext): SearchItem {
  const host = new URL(link.url).host
  return {
    id: link.id,
    title: link.title,
    subtitle: host,
    accessory: 'Link',
    preview: { text: link.url, mono: true, details: [{ label: 'Host', value: host }] },
    actions: [
      { title: 'Open', run: () => void ctx.call('system.openUrl', { url: link.url }) },
      { title: 'Copy Link', run: () => void ctx.call('clipboard.writeText', { text: link.url }) },
    ],
  }
}

export default definePlugin({
  search: {
    title: 'Links',
    icon: Bookmark,
    keywords: ['link', 'links'],
    root: { limit: 3 },
    provide: (query, { ctx }) =>
      LINKS.filter((link) => link.title.toLowerCase().includes(query.toLowerCase())).map((link) => linkItem(link, ctx)),
  },
})
```

`search` needs no permission of its own; the actions need whatever the methods they call need. API 1.2 also gives plugins the launcher's own sources, each behind a permission: `apps.index`, `apps.icons` and `apps.list` (`apps.read`), `apps.launch` (`apps.launch`) and `files.search` (`files.search`, the Spotlight index). [`plugins/clipboard`](plugins/clipboard/src/index.tsx) is a full example, with image, colour and text previews.

## Structure

```mermaid
flowchart LR
  schema[bridge-schema] --> sdk
  schema --> runtime
  schema --> cli
  sdk --> plugins[plugins: 7 defaults]
  sdk --> runtime
  cli -. builds .-> plugins
  runtime -- loads --> plugins
  macos[apps/macos: Swift host] -- serves --> runtime
  macos --> services[NotchServices]
  schema -. mirrored by hand .-> macos
```

```
packages/bridge-schema   the host ⇄ web contract: methods, topics, events, manifest
packages/sdk             @just-notch/sdk: definePlugin, PluginContext, hooks
packages/runtime         the React app in the web view: island, plugin loader, settings, mock host
packages/cli             notch create | dev | build | pack | install | check
plugins/<id>             the default plugins, written against the public SDK only
library/<id>             optional plugins, released on their own and installed from Settings › Library
apps/macos               the Swift 6 host (XcodeGen), Packages/NotchServices for system services
assets/brand             logo, app icon, menu bar glyph, lockups and wordmark masters
site                     the website (GitHub Pages)
```

## Releases

Versioning and GitHub releases run via [just-github-actions-n-workflows](https://github.com/justAnArthur/just-github-actions-n-workflows). A Conventional Commit on `main` scoped to the app (`app`, `macos`, `runtime`, `island`, a plugin id, …) bumps the version in the root `package.json` and tags `just-notch@x.y.z`; the tag builds the app and attaches `JustNotch-x.y.z.zip` and `JustNotch.zip` to the release.

Updates: the build signs the zip with Sparkle's EdDSA private key (the `SPARKLE_PRIVATE_KEY` repository secret) and attaches `appcast.xml`, which installed apps read through `releases/latest/download/`. The matching public key is `SPARKLE_PUBLIC_KEY` in [`apps/macos/project.yml`](apps/macos/project.yml). One-time setup, with [Sparkle's tools](https://github.com/sparkle-project/Sparkle/releases):

```bash
./bin/generate_keys                     # creates the key in your login keychain, prints the public key
# put the public key into SPARKLE_PUBLIC_KEY in apps/macos/project.yml
./bin/generate_keys -x sparkle-private-key
gh secret set SPARKLE_PRIVATE_KEY -R justAnArthur/just-notch < sparkle-private-key
rm sparkle-private-key
```

Keep the key: losing it means users can't update past that release without downloading by hand.

Code signing: the build signs the app with a long-lived self-signed certificate, "Just Notch Self-Signed", so its designated requirement (`identifier "com.justanarthur.justnotch" and certificate leaf = H"…"`) is the same for every release and privacy permissions and Keychain access survive updates. The certificate lives in the `MACOS_CERT_P12` (base64 `.p12`) and `MACOS_CERT_PASSWORD` repository secrets; without them the build warns and falls back to ad-hoc signing. One-time setup, on your Mac:

```bash
apps/macos/scripts/make-signing-cert.sh          # writes ~/Projects/just-notch-signing/, prints the next commands
base64 -i ~/Projects/just-notch-signing/cert.p12 | gh secret set MACOS_CERT_P12 -R justAnArthur/just-notch
gh secret set MACOS_CERT_PASSWORD -R justAnArthur/just-notch < ~/Projects/just-notch-signing/password.txt
# back up cert.p12 and password.txt (e.g. in a password manager), then:
rm -rf ~/Projects/just-notch-signing
```

Keep the certificate too: a new one changes the app's identity, and every user grants permissions again. The clean long-term fix is still a paid Developer ID certificate plus notarization: no right-click → Open, and no `disable-library-validation` entitlement.

## License

[FSL-1.1-MIT](LICENSE.md): source available, free to use, modify and run for anything except a competing product.
Each release turns MIT two years after it ships.
