#!/usr/bin/env bun
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { buildPlugin, formatError, formatResult, watchPlugin } from './build'
import { checkPlugin } from './check'
import { createPlugin, findMonorepo } from './create'
import { packPlugin } from './pack'
import { loadPlugin } from './plugin'

const USAGE = `notch — build Just Notch plugins

usage:
  notch create <id> [--dir <parent>]   scaffold a plugin (default parent: the monorepo's plugins/, else .)
  notch build [--watch]                validate manifest.json, bundle dist/index.js, generate dist/index.css
  notch dev                            build --watch for the runtime dev server
  notch pack                           build, then zip manifest.json + dist/ into <id>-<version>.notchplugin
  notch check                          validate manifest.json, then tsc --noEmit

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
      console.error('usage: notch create <id> [--dir <parent>]')
      return 1
    }
    const repo = findMonorepo(root)
    const parent = values.dir ? resolve(root, values.dir) : repo ? join(repo, 'plugins') : root
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
    const { build, file, files, bytes } = await packPlugin(root)
    console.log(formatResult(build))
    console.log(`[notch] packed ${file} (${(bytes / 1024).toFixed(1)} kB): ${files.join(', ')}`)
    return 0
  }

  if (command === 'check') {
    const { warnings, exitCode } = await checkPlugin(root)
    warn(warnings)
    console.log(exitCode === 0 ? '[notch] check passed' : '[notch] check failed: tsc reported errors')
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
