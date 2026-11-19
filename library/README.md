# library

Optional plugins. Like `plugins/*` they are workspace packages written only against the public SDK, but they are not bundled into the app (`apps/macos/scripts/copy-web.sh` copies `plugins/*` only). Each one is released on its own, listed in the catalog at `https://justanarthur.github.io/just-notch/library/index.json` and on the website, and installed from Settings › Library.

For now only the maintainer publishes: pull requests are welcome, and a merged plugin is released from `main`.

## Start one

```bash
bun run notch create <id> --library     # library/<id>, package @just-notch/plugin-<id>, version 0.1.0
bun install
bun run notch check --cwd library/<id>  # manifest, release rules, tsc
bun run notch install --watch --cwd library/<id>   # try it in the real app
```

The runtime's dev server (`bun run dev` in `packages/runtime`) also serves `library/*` beside the default plugins, with the mock host. `bun run build:library` builds them all.

## Layout

```
library/<id>/
  manifest.json        what the plugin is and may do (bridge-schema PluginManifest)
  package.json         @just-notch/plugin-<id>; its version is the release version
  src/index.tsx        default export: definePlugin(...)
  test/                bun test
  assets/icon.svg      the icon (or icon.png), shipped in the .notchplugin
  assets/screenshots/  optional *.png for the website and the catalog
  dist/                built by notch build; never committed
```

## Manifest

The usual fields (`id`, `name`, `version`, `description`, `entry`, `style`, `permissions`, `engines`) plus:

- `permissions`: ask for the fewest. A library plugin that talks to a web service needs `net`, and `secrets` if it keeps a token.
- `hosts`: the hosts `ctx.fetch` may reach without asking, such as `api.github.com`, `*.youtrack.cloud` (subdomains only) or `host:8443`: lowercase, no scheme or path. Needs `net`. Name the exact API host; for a host only the user knows (a self-hosted server), call `ctx.net.requestHost(url, reason)` instead of a wildcard, and the user is asked natively.
- `secrets`: tokens and passwords go through `ctx.secrets` / `useSecret(key)` into the Keychain, never into `ctx.storage`.
- `icon`: a `.svg` or `.png` relative to the plugin root and outside `dist/` (which `notch build` clears), such as `assets/icon.svg`. `notch pack` ships it. Draw it in the island's line style: a 24 px lucide-like glyph, 1.5 px strokes, round caps, on a dark tile.
- `engines.notch`: the plugin API range, `^<API_VERSION>` as scaffolded (`^1.4.0` today; 1.2 added the launcher's `search`, 1.3 its previews, 1.4 `windows`). The app lists a plugin it doesn't admit as incompatible and never loads it.

`version` in `manifest.json` should match `package.json`; `notch pack` stamps the `package.json` one in, and `notch check` warns when they differ.

## Commits

The plugin's id is its own commit scope (`package.json` `properties.gitCommitScopeRelatedNames`): `feat(<id>): …`, `fix(<id>): …`. It must never be one of the app's scopes in the root `package.json`, or its commits would release the app too; `notch check` errors on that. Changes to several plugins can share one commit: `feat(github,youtrack): …`.

## Release flow

1. A `feat`/`fix`/… commit scoped to `<id>` lands on `main`.
2. `bump-version.yml` bumps `library/<id>/package.json` and tags `@just-notch/plugin-<id>@x.y.z`.
3. `release-on-tag.yml` creates the GitHub release; `build-library-on-tag.yml` runs `notch pack --json` (reproducible: same sources, same SHA-256), attaches `<id>-x.y.z.notchplugin` and its `.sha256`, puts Latest back on the app's release and starts `pages.yml`.
4. `pages.yml` runs `site/scripts/library-catalog.ts`, which takes each plugin's newest stable release, checks the file against its `.sha256`, reads the manifest packed inside it (never the one on `main`) and publishes `library/index.json` with the icon and screenshots.
5. The app installs only from `https://github.com/justAnArthur/just-notch/releases/download/`, after checking the size, the SHA-256 and that the packed manifest's id, version, permissions and hosts equal the catalog's, and after the user approves them in a native dialog.

Preview the catalog without a release: `cd site && bun run catalog -- --local` packs `library/*` as they are now (set `LIBRARY_BASE_URL=http://localhost:4173/` for `bun run preview`).

## Review checklist

- Permissions and hosts are the fewest that work, and the description says why each is needed.
- No code from the network: no remote scripts, no `import()` of a URL, no `eval`, `new Function` or string timers. Everything that runs is in the `.notchplugin`.
- Data goes only to the hosts in the manifest or ones the user granted; tokens live in `ctx.secrets`.
- Dependencies are few, well known and audited (`bun audit`); the shared modules (React, modo-ui, the kit, the SDK) come from the import map, not the bundle.
- UI comes from modo-ui and the notch kit, with no arbitrary colours, type or motion.
- `dist/` is never committed; `notch check` passes and `bun test` covers the parsing and the requests.
- The icon is set and in the island's style.

## Security

All plugins run in ONE web view and share one JavaScript realm, and the plugin id on a bridge request is self-asserted. Permissions and the hosts allowlist stop mistakes, not hostile code: a malicious plugin could act as another. That is why every library plugin is reviewed line by line before it's released, and why only the maintainer publishes for now.
