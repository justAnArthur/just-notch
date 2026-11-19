# @just-notch/cli

`notch`: scaffolds, builds, checks, packs and installs Just Notch plugins. TypeScript run by Bun; esbuild bundles, UnoCSS (wind4 + the modo-ui preset) styles, fflate zips.

## commands

Run inside a plugin folder (its `build` / `dev` / `check` scripts call `notch`), or pass `--cwd <dir>`. At the repo root the workspace CLI is the `notch` script: `bun run notch build --cwd plugins/<id>`. Don't use `bunx notch` there: it resolves an unrelated npm package.

| command | does |
| --- | --- |
| `notch create <id> [--dir <parent>]` | Scaffolds `<parent>/<id>`. Default parent: the monorepo's `plugins/` when run inside it, else the current folder. Refuses an id already used in `plugins/` or `library/`. |
| `notch create <id> --library` | Scaffolds the monorepo's `library/<id>` (same as `--dir library`), with its own release scope: `properties.gitCommitScopeRelatedNames: "<id>"`. |
| `notch build [--watch]` | Validates `manifest.json`, bundles `src/index.tsx` to `dist/index.js`, generates `dist/index.css`. `--watch` rebuilds on changes under `src/` or to `manifest.json`, one status line per build. |
| `notch dev` | `build --watch`. The runtime dev server (`http://localhost:5174`) serves workspace plugins at `/plugins/<id>/` and reloads. |
| `notch pack [--out <dir>] [--json]` | Builds, then writes `<id>-<version>.notchplugin` to `--out` (default: the plugin root). The version comes from `package.json` and is stamped into the packed manifest. `--json` prints only `{ id, version, file, sha256, bytes }` on stdout (the build report goes to stderr). |
| `notch install [--watch]` | Builds, then copies `manifest.json` (stamped), `dist/` and the icon into `~/Library/Application Support/JustNotch/Plugins/<id>`, the app's user plugin folder, replacing what was there. `--watch` copies again after every rebuild. A built-in plugin with the same id wins. |
| `notch check` | Validates `manifest.json`, then runs `tsc --noEmit` in the plugin. In the monorepo's `library/` it also checks the release rules: `package.json` named `@just-notch/plugin-<id>` with `properties.gitCommitScopeRelatedNames`, an id unused in `plugins/` and absent from the root scopes (errors), the manifest version equal to `package.json`'s (warning). |

## the scaffold

- `package.json`: `@just-notch/plugin-<id>`, private, scripts `build` / `dev` / `check`. Inside the monorepo the SDK and CLI are `workspace:*`; outside they take a version range, plus `typescript` and `@types/react`.
- `tsconfig.json`: extends the repo's `tsconfig.base.json` inside the monorepo, else inlines the same options.
- `manifest.json`: `entry: dist/index.js`, `style: dist/index.css`, `permissions: []`, `engines.notch: ^<API_VERSION>`, today's plugin API from bridge-schema (`^1.3.0`).
- In `library/`: `properties.gitCommitScopeRelatedNames: "<id>"` in `package.json`.
- `src/index.tsx`: a `definePlugin` with an activity (compact leading / trailing) and a widget, using modo-ui components and token utilities.
- `.gitignore`: `dist`, `*.notchplugin`.

## output contract

What the runtime relies on:

- **`dist/index.js`**: one ES module (es2022, minified) whose default export is the `definePlugin(...)` result. The build fails without a default export. A linked `dist/index.js.map` sits beside it.
- **Bare imports, exactly the import map**: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `motion`, `motion/react`, `@justanarthur/modo-ui`, `@justanarthur/modo-ui-notch`, `@just-notch/sdk`. These stay bare imports; everything else is bundled. A subpath of these packages fails the build, and so does any `@justanarthur/modo-ui/...` import (use the barrel). JSX compiles with the automatic runtime (`react/jsx-runtime`).
- **`dist/index.css`**: always written, empty when the plugin uses no utilities. It holds only the utilities found in `src/**/*.{ts,tsx,mdx}`, plus wind4's on-demand theme variables (`--spacing`) and `@property` rules for them. No reset and no modo-ui base, tokens or component CSS: the runtime loads those once. The runtime loads the file only when `manifest.style` is set. If the plugin uses utilities but `style` is missing, the build warns.
- **`manifest.json`**: valid bridge-schema `PluginManifest`. `id` is kebab-case and matches the folder name, `version` is semver, `engines.notch` is a semver range, `permissions` are bridge-schema `Permission`s. Each `hosts` entry is a lowercase hostname (`api.github.com`, `*.youtrack.cloud`, `host:8443`) and needs the `net` permission; `net` without `hosts` warns. For `notch build`, `entry` must be `dist/index.js` and `style` must be `dist/index.css` or absent.
- **`dist/`** holds only those three files: the build removes any other file left in it.
- **`icon`** (optional): a `.png` or `.svg` path relative to the plugin root and outside `dist/` (the build clears `dist/`), for example `icon.svg`. It must exist.
- **`<id>-<version>.notchplugin`**: a zip whose root holds `manifest.json`, `dist/…` and the icon, and nothing else. `version` is `package.json`'s (the manifest's when there is none) and is written into the packed `manifest.json`. Entries are sorted and dated 1980-01-01, so the same sources give the same bytes (and sha256).

## API

`src/index.ts` exports the pieces for reuse, for example by the runtime or the host's installer:

- `validateManifest(value, { folder? })` returns `{ manifest?, errors, warnings }`. It is pure (no Node or Bun APIs). Unknown fields produce warnings; `PERMISSIONS` lists the allowed permissions.
- `classifyImport(specifier)` returns `external`, `bundle` or `error`. `SHARED_MODULES` lists the import map.
- `buildPlugin`, `watchPlugin`, `packPlugin`, `installPlugin`, `checkPlugin`, `libraryProblems`, `createPlugin`, `generateCss`.

`bun test` covers the manifest validator, the import rule, builds, packs (reproducibility, entries, the stamped version), installs, scaffolds and the library rules of temporary plugins.
