import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { installPlugin } from '../src/install'
import { packPlugin } from '../src/pack'

const parent = await mkdtemp(join(tmpdir(), 'notch-pack-'))
afterAll(() => rm(parent, { recursive: true, force: true }))

const root = join(parent, 'sample')
const manifest = {
  id: 'sample',
  name: 'Sample',
  version: '0.1.0',
  entry: 'dist/index.js',
  style: 'dist/index.css',
  icon: 'assets/icon.svg',
  permissions: [],
  engines: { notch: '^0.1.0' },
}
await Bun.write(join(root, 'manifest.json'), JSON.stringify(manifest))
await Bun.write(join(root, 'package.json'), JSON.stringify({ name: '@just-notch/plugin-sample', version: '0.3.0' }))
await Bun.write(join(root, 'assets/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
await Bun.write(
  join(root, 'src/index.tsx'),
  `import { definePlugin } from '@just-notch/sdk'
   export default definePlugin({ widget: { title: 'x', view: () => <p className="p-2">x</p> } })`,
)

describe('packPlugin', () => {
  test('is byte-reproducible', async () => {
    const a = await packPlugin(root, { out: join(parent, 'a') })
    await Bun.sleep(2100) // past the zip format's 2-second time resolution
    const b = await packPlugin(root, { out: join(parent, 'b') })
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(b.sha256).toBe(a.sha256)
    expect(b.bytes).toBe(a.bytes)
    expect(a.file).toBe(join(parent, 'a', 'sample-0.3.0.notchplugin'))
  })

  test('holds the sorted entries, the icon and the package.json version', async () => {
    const { file, files, version } = await packPlugin(root, { out: join(parent, 'c') })
    const zip = unzipSync(new Uint8Array(await Bun.file(file).arrayBuffer()))
    const expected = ['assets/icon.svg', 'dist/index.css', 'dist/index.js', 'dist/index.js.map', 'manifest.json']
    expect(Object.keys(zip)).toEqual(expected)
    expect(files).toEqual(expected)
    expect(version).toBe('0.3.0')
    expect(JSON.parse(strFromU8(zip['manifest.json']!))).toEqual({ ...manifest, version: '0.3.0' })
  })
})

describe('installPlugin', () => {
  test('copies the stamped manifest, dist/ and the icon', async () => {
    const plugins = join(parent, 'Plugins')
    await Bun.write(join(plugins, 'sample/stale.txt'), 'old')
    const { dir } = await installPlugin(root, plugins)
    expect(dir).toBe(join(plugins, 'sample'))
    expect((await Bun.file(join(dir, 'manifest.json')).json()).version).toBe('0.3.0')
    for (const f of ['dist/index.js', 'dist/index.css', 'assets/icon.svg']) expect(await Bun.file(join(dir, f)).exists()).toBe(true)
    expect(await Bun.file(join(dir, 'stale.txt')).exists()).toBe(false)
  })
})
