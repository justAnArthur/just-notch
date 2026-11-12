# Just Notch

A modular Dynamic Island for the MacBook notch. A thin native Swift host owns the window and the system services; everything you see is React + [`@justanarthur/modo-ui`](https://github.com/justAnArthur/modo/tree/main/ui) in one transparent web view; plugins add the rest.

Default plugins: Now Playing, Power, Shelf, Timer, Calendar, Controls (volume / brightness HUD), Devices, System.

## install

Download `JustNotch-x.y.z.zip` from [Releases](../../releases), unzip, move `JustNotch.app` to Applications. The app is ad-hoc signed, not notarized, so open it the first time with right-click → Open (or `xattr -dr com.apple.quarantine "/Applications/JustNotch.app"`). macOS 14+.

## develop

```bash
bun install
bun run build                       # runtime + plugins
cd apps/macos && xcodegen && xcodebuild -scheme JustNotch -configuration Debug -derivedDataPath build build
```

Live reload: `bun run dev` in `packages/runtime`, then launch the app with `NOTCH_DEV_URL=http://localhost:5174`. A browser at that URL runs the whole island against a mock host.

Write a plugin: `bun run notch create <id>`, then `bun run notch build --cwd plugins/<id>`. See [`packages/sdk`](packages/sdk/src/index.ts) and [`packages/cli`](packages/cli/README.md).

Layout, conventions and release rules: [`AGENTS.md`](AGENTS.md).
