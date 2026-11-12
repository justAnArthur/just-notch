import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPlugin } from '../src/build'

const parent = await mkdtemp(join(tmpdir(), 'notch-build-'))
afterAll(() => rm(parent, { recursive: true, force: true }))

async function plugin(id: string, source: string): Promise<string> {
  const root = join(parent, id)
  const manifest = { id, name: id, version: '0.1.0', entry: 'dist/index.js', style: 'dist/index.css', permissions: [], engines: { notch: '^0.1.0' } }
  await Bun.write(join(root, 'manifest.json'), JSON.stringify(manifest))
  await Bun.write(join(root, 'src/index.tsx'), source)
  return root
}

describe('buildPlugin', () => {
  test('leaves shared modules as bare imports', async () => {
    const root = await plugin(
      'ok',
      `import { Button } from '@justanarthur/modo-ui'
       import { definePlugin } from '@just-notch/sdk'
       import { motion } from 'motion/react'
       export default definePlugin({ widget: { title: 'x', view: () => <motion.div className="p-2"><Button>x</Button></motion.div> } })`,
    )
    const result = await buildPlugin(root)
    const js = await Bun.file(join(root, 'dist/index.js')).text()
    for (const specifier of ['@justanarthur/modo-ui', '@just-notch/sdk', 'motion/react', 'react/jsx-runtime'])
      expect(js).toContain(`from"${specifier}"`)
    expect(result.jsBytes).toBeLessThan(1024)
    expect(await Bun.file(join(root, 'dist/index.css')).text()).toContain('.p-2{')
  })

  test('fails on a modo-ui subpath', async () => {
    const root = await plugin(
      'subpath',
      `import Button from '@justanarthur/modo-ui/components/button'
       export default { widget: { title: 'x', view: Button } }`,
    )
    await expect(buildPlugin(root)).rejects.toThrow('import modo-ui from the barrel "@justanarthur/modo-ui"')
  })

  test('fails without a default export', async () => {
    const root = await plugin('nodefault', `export const x = 1`)
    await expect(buildPlugin(root)).rejects.toThrow('must `export default definePlugin')
  })

  test('fails on an invalid manifest', async () => {
    const root = await plugin('Bad_Id', `export default {}`)
    await expect(buildPlugin(root)).rejects.toThrow('manifest.json is invalid')
  })
})
