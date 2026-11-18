import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { libraryProblems } from '../src/check'
import { createPlugin, ENGINES_NOTCH } from '../src/create'
import { loadPlugin } from '../src/plugin'

let repo: string
beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'notch-repo-'))
  await Bun.write(join(repo, 'package.json'), JSON.stringify({ name: 'just-notch', properties: { gitCommitScopeRelatedNames: 'app,cli,clock' } }))
  await mkdir(join(repo, 'plugins/clock'), { recursive: true })
  await mkdir(join(repo, 'library'), { recursive: true })
})
afterAll(() => rm(repo, { recursive: true, force: true }))

async function problems(root: string) {
  return libraryProblems(root, (await loadPlugin(root)).manifest)
}

async function editPackage(root: string, edit: (pkg: Record<string, any>) => void) {
  const pkg = await Bun.file(join(root, 'package.json')).json()
  edit(pkg)
  await Bun.write(join(root, 'package.json'), JSON.stringify(pkg))
}

describe('createPlugin', () => {
  test('a library plugin gets its own release scope', async () => {
    const root = await createPlugin('github', join(repo, 'library'))
    const pkg = await Bun.file(join(root, 'package.json')).json()
    expect(pkg.name).toBe('@just-notch/plugin-github')
    expect(pkg.version).toBe('0.1.0')
    expect(pkg.properties).toEqual({ gitCommitScopeRelatedNames: 'github' })
    expect((await Bun.file(join(root, 'manifest.json')).json()).engines).toEqual({ notch: ENGINES_NOTCH })
    expect(await problems(root)).toEqual({ errors: [], warnings: [] })
  })

  test('a default plugin does not', async () => {
    const root = await createPlugin('weather', join(repo, 'plugins'))
    expect((await Bun.file(join(root, 'package.json')).json()).properties).toBeUndefined()
    expect(await problems(root)).toEqual({ errors: [], warnings: [] })
  })

  test('refuses an id taken in plugins/ or library/', async () => {
    await expect(createPlugin('clock', join(repo, 'library'))).rejects.toThrow('taken by plugins/clock')
    await expect(createPlugin('github', join(repo, 'plugins'))).rejects.toThrow('taken by library/github')
  })
})

describe('libraryProblems', () => {
  test('flags a missing scope, a version drift and the wrong package name', async () => {
    const root = await createPlugin('youtrack', join(repo, 'library'))
    await editPackage(root, (pkg) => {
      delete pkg.properties
      pkg.version = '0.2.0'
      pkg.name = 'youtrack'
    })
    const { errors, warnings } = await problems(root)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('"@just-notch/plugin-youtrack"')
    expect(errors[1]).toContain('gitCommitScopeRelatedNames')
    expect(warnings).toEqual(['manifest.json version 0.1.0 differs from package.json 0.2.0; notch pack stamps the package.json one'])
  })

  test('flags an id that collides with plugins/ or sits in the root scopes', async () => {
    const root = join(repo, 'library/clock')
    await Bun.write(
      join(root, 'manifest.json'),
      JSON.stringify({ id: 'clock', name: 'Clock', version: '0.1.0', entry: 'dist/index.js', permissions: [], engines: { notch: '^0.1.0' } }),
    )
    await Bun.write(join(root, 'package.json'), JSON.stringify({ name: '@just-notch/plugin-clock', version: '0.1.0', properties: { gitCommitScopeRelatedNames: 'clock' } }))
    const { errors } = await problems(root)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('taken by plugins/clock')
    expect(errors[1]).toContain('root package.json')
  })
})
