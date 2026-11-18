## What and why

<!-- What changes, and why. Link the issue if there is one. -->

## Checks

- [ ] `bun run check`
- [ ] Tests for what changed (`bun test` in the package)
- [ ] Conventional Commit with the right scope: an app scope (`runtime`, `host`, a default plugin id, …) releases the app; a library plugin's id releases only that plugin; unscoped releases nothing

## Library plugin

<!-- Only for library/<id>. Delete this section otherwise. See library/README.md. -->

- [ ] Scaffolded with `bun run notch create <id> --library`; `bun run notch check --cwd library/<id>` passes
- [ ] Commits scoped to the plugin id, which is not in the root `gitCommitScopeRelatedNames`
- [ ] The fewest permissions and `hosts` that work; the description says why each is needed
- [ ] No remote code: no remote scripts, no `import()` of a URL, no `eval` or `new Function`
- [ ] Tokens only in `ctx.secrets`; data goes only to the manifest's hosts or ones the user grants
- [ ] Dependencies few and audited (`bun audit`)
- [ ] `manifest.icon` set (`assets/icon.svg`, outside `dist/`); screenshots in `assets/screenshots/` if any
- [ ] `dist/` not committed
