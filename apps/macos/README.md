# Just Notch — macOS host

The native shell: one transparent, non-activating panel at the notch with a WKWebView that runs `packages/runtime`, the `host` bridge (`packages/bridge-schema`, mirrored in `JustNotch/Bridge/Schema.swift`) and the system services from `Packages/NotchServices`.

## build

```sh
brew install xcodegen
cd apps/macos
xcodegen
xcodebuild -project JustNotch.xcodeproj -scheme JustNotch -configuration Debug -derivedDataPath build build
open build/Build/Products/Debug/JustNotch.app
```

The build copies `packages/runtime/dist/` into `Resources/Web` and every `plugins/<id>/` that has a `dist/` into `Resources/Web/plugins/<id>/` (`scripts/copy-web.sh`). Build the web side first (`bun run build` at the root); without `packages/runtime/dist` the bundle gets a placeholder page that draws a black island and exercises the bridge.

`project.yml` is the source of truth; `JustNotch.xcodeproj`, `JustNotch/Info.plist` and `JustNotch/JustNotch.entitlements` are generated from it.

Debug builds are signed ad hoc, and Xcode drops the hardened runtime for them. Release builds keep it, so they carry `com.apple.security.cs.disable-library-validation`: an ad-hoc signature has no Team ID, and library validation would otherwise refuse the embedded Sparkle.framework at launch.

Release builds also need `SPARKLE_PUBLIC_KEY` in `project.yml` (see Releases in the root README); while it's the placeholder they fail, and other builds run with updates off.

## dev mode

Point the host at the runtime's Vite dev server:

```sh
NOTCH_DEV_URL=http://localhost:5174 build/Build/Products/Debug/JustNotch.app/Contents/MacOS/JustNotch
# or
open --env NOTCH_DEV_URL=http://localhost:5174 build/Build/Products/Debug/JustNotch.app
```

The panel loads `<dev>/index.html` (settings is a page of the island), `HostInfo.devMode` is true and plugin `baseUrl`s become `<dev>/plugins/<id>/`. Debug builds make the web views inspectable: Safari → Develop → <this Mac> → Just Notch.

## where things live

- `JustNotch/App` — app delegate (panels per screen, pointer monitors, Settings… opening the island on its settings page, status item, launch at login), main menu.
- `JustNotch/Window` — `NotchPanel` and the screen layout (notch rect, virtual notch), `NotchWebView` (hit testing, file drops), `PanelController` (hit regions, hover, drags).
- `JustNotch/Bridge` — the `host` message handler (permissions, routing, subscriptions), the per-frame event dispatcher, per-plugin storage.
- `JustNotch/Web` — the `notch://app/` scheme handler and web view setup.
- `JustNotch/Plugins` — plugin discovery and the user plugin folder watcher.

User data: `~/Library/Application Support/JustNotch/` (`Plugins/<id>/`, `Storage/<plugin>.json`). Set `defaults write com.justanarthur.justnotch panel.screens all` to put a panel on every screen (default: the notched, else built-in, screen only).
