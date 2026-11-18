import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { ID } from './manifest'
import { CliError, ENTRY, STYLE } from './plugin'

// TODO(phase 3): derive from the SDK's API_VERSION instead of the range every built-in plugin declares.
export const ENGINES_NOTCH = '^0.1.0'

const { version: CLI_VERSION } = (await Bun.file(join(import.meta.dir, '../package.json')).json()) as { version: string }

/** The just-notch monorepo root above `from`, if any. */
export function findMonorepo(from: string): string | undefined {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === 'just-notch') return dir
    if (dir === dirname(dir)) return undefined
  }
}

function title(id: string): string {
  return id
    .split('-')
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')
}

const BASE_COMPILER_OPTIONS = {
  target: 'ES2022',
  module: 'ESNext',
  moduleResolution: 'Bundler',
  jsx: 'react-jsx',
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  isolatedModules: true,
  verbatimModuleSyntax: true,
  lib: ['ES2023', 'DOM', 'DOM.Iterable'],
}

const source = (name: string) => `import { Badge, Button } from '@justanarthur/modo-ui'
import { definePlugin, usePlugin } from '@just-notch/sdk'
import { useEffect, useState } from 'react'

function Dot() {
  return (
    <Badge variant="dot" color="green" size="compact">
      ${name}
    </Badge>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <span className="text-caption tabular-nums text-foreground">
      {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

function Hello() {
  return <p className="text-subtitle text-foreground px-4 py-2">Hello from ${name}</p>
}

function Widget() {
  const { activity } = usePlugin()
  return (
    <div className="flex flex-col items-start gap-2 p-3">
      <p className="text-body text-muted-foreground">A plugin built with notch create.</p>
      <Button variant="secondary" size="compact" onClick={() => activity.flash({ priority: 'alert', view: Hello })}>
        Say hello
      </Button>
    </div>
  )
}

export default definePlugin({
  activate(ctx) {
    ctx.activity.show({ priority: 'ambient', compact: { leading: Dot, trailing: Clock } })
    return () => ctx.activity.hide()
  },
  widget: { title: '${name}', view: Widget },
})
`

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * Scaffolds `<parent>/<id>`; returns the plugin folder. In the monorepo's `library/` the package also gets
 * its own release scope (`properties.gitCommitScopeRelatedNames`), so it is versioned and tagged on its own.
 */
export async function createPlugin(id: string, parent: string): Promise<string> {
  if (!ID.test(id)) throw new CliError(`plugin id must be kebab-case like "my-plugin" (got "${id}")`)
  const root = join(resolve(parent), id)
  if (existsSync(root)) throw new CliError(`${root} already exists`)

  const repo = findMonorepo(parent)
  const taken = repo && ['plugins', 'library'].find((folder) => existsSync(join(repo, folder, id)))
  if (taken) throw new CliError(`id "${id}" is taken by ${taken}/${id}`)
  const library = repo !== undefined && resolve(parent) === join(repo, 'library')
  const range = `^${CLI_VERSION}`
  const name = title(id)

  const pkg = {
    name: `@just-notch/plugin-${id}`,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: { build: 'notch build', dev: 'notch dev', check: 'notch check' },
    dependencies: { '@just-notch/sdk': repo ? 'workspace:*' : range },
    peerDependencies: { react: '>=19' },
    devDependencies: {
      '@justanarthur/modo-ui': '^2.2.0',
      '@just-notch/cli': repo ? 'workspace:*' : range,
      ...(repo ? {} : { typescript: '^5.9.0', '@types/react': '^19.2.0' }),
    },
    ...(library ? { properties: { gitCommitScopeRelatedNames: id } } : {}),
  }

  const tsconfig = repo
    ? { extends: relative(root, join(repo, 'tsconfig.base.json')), include: ['src'] }
    : { compilerOptions: BASE_COMPILER_OPTIONS, include: ['src'] }

  const manifest = {
    id,
    name,
    version: '0.1.0',
    entry: ENTRY,
    style: STYLE,
    permissions: [],
    engines: { notch: ENGINES_NOTCH },
  }

  await mkdir(join(root, 'src'), { recursive: true })
  await Promise.all([
    Bun.write(join(root, 'package.json'), json(pkg)),
    Bun.write(join(root, 'tsconfig.json'), json(tsconfig)),
    Bun.write(join(root, 'manifest.json'), json(manifest)),
    Bun.write(join(root, '.gitignore'), 'dist\n*.notchplugin\n'),
    Bun.write(join(root, 'src/index.tsx'), source(name)),
  ])
  return root
}
