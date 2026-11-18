# library

Optional plugins: workspace packages like `plugins/*`, written only against the public SDK, but not bundled into the app (`apps/macos/scripts/copy-web.sh` copies `plugins/*` only). The runtime dev server serves them at `/plugins/<id>/` beside the default plugins, tagged `builtIn: false`.

- Build: `bun run build:library` (the root `build` covers `plugins/*` only).
- Scaffold: `bun run notch create <id> --library`, then `bun install` and `bun run notch check --cwd library/<id>`. Try it in the app: `bun run notch install --watch --cwd library/<id>`.
- Releases: each plugin is versioned by its `package.json` and released on its own as `@just-notch/plugin-<id>@x.y.z` with a `.notchplugin` attached. Its id is its own commit scope (`properties.gitCommitScopeRelatedNames`), never a scope of the app. See "library plugins" in AGENTS.md.
