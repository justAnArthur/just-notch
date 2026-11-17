# AGENTS.md — just-notch

A modular macOS notch app. A thin Swift host owns the window and system services; everything visible is React + `@justanarthur/modo-ui` in ONE transparent WKWebView. Plugins add behavior and UI.

## layout

- `packages/bridge-schema` — the host ⇄ web contract (methods, topics, events, manifest). Source of truth; the Swift host mirrors it as Codable by hand. Change both in the same commit.
- `packages/sdk` — `@just-notch/sdk`: `definePlugin`, `PluginContext`, hooks. Shared at runtime through the import map.
- `packages/runtime` — the React app inside the web view: island shell, activity manager, plugin loader, settings page, mock host (runs in any browser).
- `packages/cli` — `notch create | dev | build | pack | check` for plugins. At the root: `bun run notch <command> --cwd plugins/<id>` (not `bunx notch`, an unrelated npm package).
- `plugins/<id>` — default plugins, written only against the public SDK.
- `apps/macos` — Swift 6, macOS 14+, XcodeGen `project.yml`. `Packages/NotchServices` — system services as a SwiftPM package (protocol in `Service.swift`).

## runtime conventions (shared by runtime, CLI and plugins)

- The page is served from `notch://app/` (prod) or the Vite dev server (dev). Plugins live under `<origin>/plugins/<id>/` (same origin, so ES modules load without CORS).
- Shared modules via import map, emitted by the runtime build to `shared/`: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `motion`, `motion/react`, `@justanarthur/modo-ui`, `@justanarthur/modo-ui-notch`, `@just-notch/sdk`. Plugin builds mark exactly these external. Plugins import modo-ui and the kit from their barrels only.
- Plugin UI comes from the notch kit (`@justanarthur/modo-ui-notch`): a plugin maps host topics onto a kit block and its parts (`.Leading` / `.Trailing` / `.Minimal` / flash). New visuals go into the kit in the modo repo, not into a plugin.
- A plugin folder: `manifest.json` (bridge-schema `PluginManifest`), `dist/index.js` (default export = `definePlugin(...)`), optional `dist/index.css` (UnoCSS with `@justanarthur/modo-ui/unocss` preset over the plugin's sources).
- The island is always on true black: the `--island` token (runtime `tokens/island.css`) and the `.island` scope pin dark and lift the modo-ui surface ladder from it.

## styling

modo-ui rules apply (see its AGENTS.md / DESIGN.md in github.com/justAnArthur/modo, `ui/`): tokens only through its utilities (`bg-surface-N`, `text-<role>`, `text-muted-foreground`, `bg-hover`, `spring.*` from motion tiers), no arbitrary color/type/radius/shadow/motion values, no inline style for visuals. Arbitrary values are fine for layout geometry. Missing a step? Add a token in `tokens/*.css`.

## code style

Sparse: smallest correct code, trust the types, early returns, no comments except a non-obvious why. Default exports for components. `interface` over `type` for objects.

## checks

- `bun run check` (typecheck all workspaces)
- `cd apps/macos/Packages/NotchServices && swift build`
- `cd apps/macos && xcodegen && xcodebuild -scheme JustNotch -configuration Debug build`

## releases

- One versioned product: the app, versioned in the root `package.json` (`just-notch`, tags `just-notch@x.y.z`). The workspace packages and plugins are private and ship inside the app.
- `bump-version.yml` (from just-github-actions-n-workflows, see `.github/AGENTS.md`) bumps on push to `main` from Conventional Commits whose scope is one of the root `properties.gitCommitScopeRelatedNames` (`app`, `macos`, `host`, `services`, `runtime`, `island`, `sdk`, `cli`, `bridge-schema`, `plugins`, or a plugin id): `feat` minor, `fix`/`perf`/`refactor`/… patch, `!` major. Unscoped commits (and `[skip bump]`) don't release.
- A new tag starts `release-on-tag.yml` (GitHub release with notes) and `build-macos-on-tag.yml` (builds the app on macOS with `MARKETING_VERSION` from the tag, attaches `JustNotch-x.y.z.zip`).
- Toolkit workflow files are managed by its CLI (`npx @justanarthur/just-github-actions-n-workflows-cli update`); don't edit `bump-version.yml` / `release-on-tag.yml` by hand. `ci.yml` and `build-macos-on-tag.yml` are this repo's own.
