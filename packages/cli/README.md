# @just-notch/cli

`notch`: scaffolds, builds, checks and packs Just Notch plugins. TypeScript run by Bun; esbuild bundles, UnoCSS (wind4 + the modo-ui preset) styles, fflate zips.

## commands

Run inside a plugin folder (its `build` / `dev` / `check` scripts call `notch`), or pass `--cwd <dir>`. At the repo root the workspace CLI is the `notch` script: `bun run notch build --cwd plugins/<id>`. Don't use `bunx notch` there: it resolves an unrelated npm package.

| command | does |
| --- | --- |
| `notch create <id> [--dir <parent>]` | Scaffolds `<parent>/<id>`. Default parent: the monorepo's `plugins/` when run inside it, else the current folder. |
| `notch build [--watch]` | Validates `manifest.json`, bundles `src/index.tsx` to `dist/index.js`, generates `dist/index.css`. `--watch` rebuilds on changes under `src/` or to `manifest.json`, one status line per build. |
| `notch dev` | `build --watch`. The runtime dev server (`http://localhost:5174`) serves workspace plugins at `/plugins/<id>/` and reloads. |
| `notch pack` | Builds, then writes `<id>-<version>.notchplugin` at the plugin root. |
| `notch check` | Validates `manifest.json`, then runs `tsc --noEmit` in the plugin. |

## the scaffold

- `package.json`: `@just-notch/plugin-<id>`, private, scripts `build` / `dev` / `check`. Inside the monorepo the SDK and CLI are `workspace:*`; outside they take a version range, plus `typescript` and `@types/react`.
- `tsconfig.json`: extends the repo's `tsconfig.base.json` inside the monorepo, else inlines the same options.
- `manifest.json`: `entry: dist/index.js`, `style: dist/index.css`, `permissions: []`, `engines.notch: ^0.1.0`.
- `src/index.tsx`: a `definePlugin` with an activity (compact leading / trailing) and a widget, using modo-ui components and token utilities.
- `.gitignore`: `dist`, `*.notchplugin`.

## output contract

What the runtime relies on:

- **`dist/index.js`**: one ES module (es2022, minified) whose default export is the `definePlugin(...)` result. The build fails without a default export. A linked `dist/index.js.map` sits beside it.
- **Bare imports, exactly the import map**: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `motion`, `motion/react`, `@justanarthur/modo-ui`, `@just-notch/sdk`. These stay bare imports; everything else is bundled. A subpath of these packages fails the build, and so does any `@justanarthur/modo-ui/...` import (use the barrel). JSX compiles with the automatic runtime (`react/jsx-runtime`).
- **`dist/index.css`**: always written, empty when the plugin uses no utilities. It holds only the utilities found in `src/**/*.{ts,tsx,mdx}`, plus wind4's on-demand theme variables (`--spacing`) and `@property` rules for them. No reset and no modo-ui base, tokens or component CSS: the runtime loads those once. The runtime loads the file only when `manifest.style` is set. If the plugin uses utilities but `style` is missing, the build warns.
- **`manifest.json`**: valid bridge-schema `PluginManifest`. `id` is kebab-case and matches the folder name, `version` is semver, `engines.notch` is a semver range, `permissions` are bridge-schema `Permission`s. For `notch build`, `entry` must be `dist/index.js` and `style` must be `dist/index.css` or absent.
- **`dist/`** holds only those three files: the build removes any other file left in it.
- **`<id>-<version>.notchplugin`**: a zip whose root holds `manifest.json` and `dist/…`, and nothing else.

## API

`src/index.ts` exports the pieces for reuse, for example by the runtime or the host's installer:

- `validateManifest(value, { folder? })` returns `{ manifest?, errors, warnings }`. It is pure (no Node or Bun APIs). Unknown fields produce warnings; `PERMISSIONS` lists the allowed permissions.
- `classifyImport(specifier)` returns `external`, `bundle` or `error`. `SHARED_MODULES` lists the import map.
- `buildPlugin`, `watchPlugin`, `packPlugin`, `checkPlugin`, `createPlugin`, `generateCss`.

`bun test` covers the manifest validator, the import rule, and builds of temporary plugins.
