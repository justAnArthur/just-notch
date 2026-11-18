<a href="https://justanarthur.github.io/just-notch/"><img src=".github/banner.svg" alt="A Dynamic Island for your notch: a thin Swift host owns the window and the system services; plugins written in React draw everything you see." width="100%"></a>

# Just Notch

[![ci](https://github.com/justAnArthur/just-notch/actions/workflows/ci.yml/badge.svg)](https://github.com/justAnArthur/just-notch/actions/workflows/ci.yml)
[![license: FSL-1.1-MIT](https://img.shields.io/badge/license-FSL--1.1--MIT-blue)](LICENSE.md)

A modular Dynamic Island for the MacBook notch. A thin native Swift host owns the window and the system services; everything you see is React + [`@justanarthur/modo-ui`](https://github.com/justAnArthur/modo/tree/main/ui) in one transparent web view; plugins add the rest.

Seven default plugins, built on the `@justanarthur/modo-ui-notch` kit: Now Playing, Calendar, Weather, Clock (with Pomodoro), System, Clipboard and Recent files.

**[Download for Mac →](https://github.com/justAnArthur/just-notch/releases/latest/download/JustNotch.zip)** · [Website](https://justanarthur.github.io/just-notch/)

![The Now Playing plugin in the open island: track, artist, scrubber and playback controls](.github/screenshot.png)

## Install

Download [`JustNotch.zip`](https://github.com/justAnArthur/just-notch/releases/latest/download/JustNotch.zip) (or a versioned `JustNotch-x.y.z.zip` from [Releases](../../releases)), unzip, move `JustNotch.app` to Applications. macOS 14+.

The app is ad-hoc signed, not notarized, so open it the first time with right-click → Open, or:

```bash
xattr -dr com.apple.quarantine /Applications/JustNotch.app
```

### Updates

The app updates itself with [Sparkle](https://sparkle-project.org): it checks once a day, and on demand from the menu bar icon's **Check for Updates…** or Settings › About. Updates are verified with an EdDSA signature, then installed and relaunched; no second right-click → Open.

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

Write a plugin: `bun run notch create <id>`, then `bun run notch build --cwd plugins/<id>`. See [`packages/sdk`](packages/sdk/src/index.ts) and [`packages/cli`](packages/cli/README.md).

just-notch is `apps/notch` in the just-apps monorepo and builds only inside a just-apps checkout. Layout, conventions and release rules: [`AGENTS.md`](AGENTS.md).

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
packages/cli             notch create | dev | build | pack | check
plugins/<id>             the default plugins, written against the public SDK only
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

## License

[FSL-1.1-MIT](LICENSE.md): source available, free to use, modify and run for anything except a competing product.
Each release turns MIT two years after it ships.
