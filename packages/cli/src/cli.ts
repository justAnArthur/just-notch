#!/usr/bin/env bun
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { buildPlugin, formatError, formatResult, watchPlugin } from './build'
import { checkPlugin } from './check'
import { createPlugin, findMonorepo } from './create'
import { installPlugin, watchInstall } from './install'
import { packPlugin } from './pack'
import { loadPlugin } from './plugin'

const USAGE = `notch — build Just Notch plugins

usage:
  notch create <id> [--dir <parent>]   scaffold a plugin (default parent: the monorepo's plugins/, else .)
  notch create <id> --library          scaffold an optional plugin in the monorepo's library/, with its own release scope
  notch build [--watch]                validate manifest.json, bundle dist/index.js, generate dist/index.css
  notch dev                            build --watch for the runtime dev server
  notch pack [--out <dir>] [--json]    build, then zip manifest.json + dist/ (+ icon) into <id>-<version>.notchplugin
                                       (version from package.json; --json prints { id, version, file, sha256, bytes })
  notch install [--watch]              build, then copy into ~/Library/Application Support/JustNotch/Plugins/<id>
  notch check                          validate manifest.json (and library/ release rules), then tsc --noEmit

options:
  --cwd <dir>   the plugin folder (default: .)
  -h, --help    show this help`

function warn(warnings: string[]) {
  for (const w of warnings) console.warn(`[notch] warning: ${w}`)
}

async function run(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: 'string' },
      dir: { type: 'string' },
      library: { type: 'boolean' },
      out: { type: 'string' },
      json: { type: 'boolean' },
      watch: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  const [command, ...rest] = positionals
  const root = resolve(values.cwd ?? '.')

  if (values.help || command === undefined) {
    console.log(USAGE)
    return command === undefined && !values.help ? 1 : 0
  }

  if (command === 'create') {
    const [id] = rest
    if (id === undefined) {
      console.error('usage: notch create <id> [--dir <parent> | --library]')
      return 1
    }
    const repo = findMonorepo(root)
    if (values.library && !repo) {
      console.error('[notch] error: --library needs the just-notch monorepo (library/ lives at its root)')
      return 1
    }
    const parent = values.library
      ? join(repo!, 'library')
      : values.dir
        ? resolve(root, values.dir)
        : repo
          ? join(repo, 'plugins')
          : root
    const dir = await createPlugin(id, parent)
    console.log(`[notch] created ${dir}\n  next: bun install, then cd ${dir} && bun run dev`)
    return 0
  }

  if (command === 'build' && values.watch) return watchPlugin(root)

  if (command === 'build') {
    console.log(formatResult(await buildPlugin(root)))
    return 0
  }

  if (command === 'dev') {
    const { manifest } = await loadPlugin(root)
    console.log(
      `[notch] watching ${manifest.id}; the runtime dev server (http://localhost:5174) serves it at /plugins/${manifest.id}/ and reloads on rebuild`,
    )
    return watchPlugin(root)
  }

  if (command === 'pack') {
    const { build, id, version, file, files, bytes, sha256 } = await packPlugin(root, { out: values.out && resolve(values.out) })
    if (values.json) {
      // stdout carries only the JSON, for scripts; the build report goes to stderr.
      console.error(formatResult(build))
      console.log(JSON.stringify({ id, version, file, sha256, bytes }))
      return 0
    }
    console.log(formatResult(build))
    console.log(`[notch] packed ${file} (${(bytes / 1024).toFixed(1)} kB, sha256 ${sha256}): ${files.join(', ')}`)
    return 0
  }

  if (command === 'install' && values.watch) return watchInstall(root)

  if (command === 'install') {
    const { build, dir } = await installPlugin(root)
    console.log(`${formatResult(build)}\n[notch] installed ${dir}`)
    return 0
  }

  if (command === 'check') {
    const { errors, warnings, exitCode } = await checkPlugin(root)
    warn(warnings)
    for (const e of errors) console.error(`[notch] error: ${e}`)
    console.log(exitCode === 0 ? '[notch] check passed' : `[notch] check failed: ${errors.length > 0 ? 'see the errors above' : 'tsc reported errors'}`)
    return exitCode
  }

  console.error(`unknown command "${command}"\n\n${USAGE}`)
  return 1
}

try {
  process.exit(await run())
} catch (error) {
  console.error(formatError(error))
  process.exit(1)
}
