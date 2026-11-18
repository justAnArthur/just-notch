import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, expect, test } from 'vitest'
import notchRuntime from './vite-plugin'

const root = mkdtempSync(join(tmpdir(), 'notch-vite-'))
writeFileSync(join(root, 'entry.ts'), "export { usePlugin } from '@just-notch/sdk'\n")
let server: ViteDevServer

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root,
    cacheDir: join(root, '.vite'),
    logLevel: 'silent',
    plugins: [notchRuntime()],
    server: { ws: false },
  })
}, 60_000)

afterAll(async () => {
  await server.close()
  rmSync(root, { recursive: true })
})

const sharedImports = async () => (await server.transformRequest('/entry.ts'))?.code.match(/\/shared\/[^"']+/g)

test('the shared modules resolve their own chunks', async () => {
  await expect(server.transformRequest('/shared/sdk.js')).resolves.toBeTruthy()
  await expect(server.transformRequest('/shared/react-dom-client.js')).resolves.toBeTruthy()
})

// A `?t=` stamp makes the runtime load its own SDK beside the plugins' (import map, no stamp): their hooks then throw.
test("the runtime imports the shared modules at the import map's URLs, also after a file is created", async () => {
  expect(await sharedImports()).toEqual(['/shared/sdk.js'])
  const file = join(root, 'created.ts')
  writeFileSync(file, 'export {}\n')
  server.watcher.emit('add', file)
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(await sharedImports()).toEqual(['/shared/sdk.js'])
})
