# library

Optional plugins: workspace packages like `plugins/*`, written only against the public SDK, but not bundled into the app (`apps/macos/scripts/copy-web.sh` copies `plugins/*` only). The runtime dev server serves them at `/plugins/<id>/` beside the default plugins, tagged `builtIn: false`.

- Build: `bun run build:library` (the root `build` covers `plugins/*` only).
- Scaffold: `bun run notch create <id> --dir library`, then `bun run notch check --cwd library/<id>`.
- Commit scopes: a library plugin's id is not a release scope of the app.
